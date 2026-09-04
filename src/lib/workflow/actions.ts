import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import type { CurrentUser } from "@/lib/auth/session";
import { requireCapability, requireDepartmentAccess, ApiError } from "@/lib/rbac/guard";
import { assertTransition } from "@/lib/workflow/stateMachine";
import { writeAuditLog } from "@/lib/audit/log";
import { sumDecimals, ZERO } from "@/lib/money/decimal";

async function loadVersionOrThrow(tx: Prisma.TransactionClient, versionId: string) {
  const version = await tx.budgetVersion.findUnique({
    where: { id: versionId },
    include: { lines: true },
  });
  if (!version) throw new ApiError(404, "找不到此預算版本");
  return version;
}

function assertNoUnconfiguredFormulas(lines: { formulaStatus: string; accountId: string }[]) {
  const unconfigured = lines.filter((l) => l.formulaStatus === "NOT_CONFIGURED");
  if (unconfigured.length > 0) {
    throw new ApiError(
      422,
      `仍有 ${unconfigured.length} 個公式科目尚未設定公式或薪資資料來源，無法送出或核准。請先於「公式設定」完成設定。`
    );
  }
}

export async function submitBudgetVersion(user: CurrentUser, versionId: string) {
  await requireCapability(user, "budget.submit_own_department");

  return prisma.$transaction(async (tx) => {
    const version = await loadVersionOrThrow(tx, versionId);
    await requireDepartmentAccess(user, version.departmentId);
    assertTransition(version.status, "submit");

    if (version.lines.length === 0) {
      throw new ApiError(422, "尚未填寫任何科目金額，無法送出");
    }
    assertNoUnconfiguredFormulas(version.lines);

    const updated = await tx.budgetVersion.update({
      where: { id: versionId },
      data: {
        status: "SUBMITTED",
        preparedById: version.preparedById ?? user.id,
        submittedById: user.id,
        submittedAt: new Date(),
        returnReason: null,
      },
    });

    await writeAuditLog(
      {
        actorUserId: user.id,
        action: "BUDGET_SUBMITTED",
        entityType: "BudgetVersion",
        entityId: versionId,
        beforeData: { status: version.status },
        afterData: { status: updated.status },
      },
      tx
    );

    return updated;
  });
}

export async function startReview(user: CurrentUser, versionId: string) {
  await requireCapability(user, "budget.finance_review");

  return prisma.$transaction(async (tx) => {
    const version = await loadVersionOrThrow(tx, versionId);
    assertTransition(version.status, "startReview");

    const updated = await tx.budgetVersion.update({
      where: { id: versionId },
      data: { status: "UNDER_REVIEW", reviewedById: user.id, reviewStartedAt: new Date() },
    });

    await writeAuditLog(
      {
        actorUserId: user.id,
        action: "BUDGET_REVIEW_STARTED",
        entityType: "BudgetVersion",
        entityId: versionId,
        beforeData: { status: version.status },
        afterData: { status: updated.status },
      },
      tx
    );

    return updated;
  });
}

export async function returnBudgetVersion(user: CurrentUser, versionId: string, reason: string) {
  await requireCapability(user, "budget.return");
  if (!reason || reason.trim().length === 0) {
    throw new ApiError(422, "退回必須填寫原因");
  }

  return prisma.$transaction(async (tx) => {
    const version = await loadVersionOrThrow(tx, versionId);
    assertTransition(version.status, "return");
    if (version.reviewedById !== user.id) {
      throw new ApiError(409, "此案件目前由其他財務覆核人員處理中");
    }

    const updated = await tx.budgetVersion.update({
      where: { id: versionId },
      data: { status: "RETURNED", returnedAt: new Date(), returnReason: reason },
    });

    await tx.memoryEntry.create({
      data: {
        type: "RETURN_REASON",
        scopeDepartmentId: version.departmentId,
        fiscalYear: version.fiscalYear,
        source: `workflow:return:${versionId}`,
        payload: { versionId, reason },
        createdById: user.id,
        isUserDeletable: false,
      },
    });

    await writeAuditLog(
      {
        actorUserId: user.id,
        action: "BUDGET_RETURNED",
        entityType: "BudgetVersion",
        entityId: versionId,
        reason,
        beforeData: { status: version.status },
        afterData: { status: updated.status },
      },
      tx
    );

    return updated;
  });
}

export async function resubmitBudgetVersion(user: CurrentUser, versionId: string) {
  return submitResubmitShared(user, versionId, "resubmit");
}

async function submitResubmitShared(user: CurrentUser, versionId: string, action: "submit" | "resubmit") {
  await requireCapability(user, "budget.submit_own_department");

  return prisma.$transaction(async (tx) => {
    const version = await loadVersionOrThrow(tx, versionId);
    await requireDepartmentAccess(user, version.departmentId);
    assertTransition(version.status, action);
    assertNoUnconfiguredFormulas(version.lines);

    const updated = await tx.budgetVersion.update({
      where: { id: versionId },
      data: { status: "SUBMITTED", submittedById: user.id, submittedAt: new Date() },
    });

    await writeAuditLog(
      {
        actorUserId: user.id,
        action: action === "resubmit" ? "BUDGET_RESUBMITTED" : "BUDGET_SUBMITTED",
        entityType: "BudgetVersion",
        entityId: versionId,
        beforeData: { status: version.status },
        afterData: { status: updated.status },
      },
      tx
    );

    return updated;
  });
}

export async function approveBudgetVersion(user: CurrentUser, versionId: string) {
  await requireCapability(user, "budget.approve");

  return prisma.$transaction(async (tx) => {
    const version = await loadVersionOrThrow(tx, versionId);
    assertTransition(version.status, "approve");
    assertNoUnconfiguredFormulas(version.lines);

    // Segregation of duties: preparer/submitter/reviewer must not be able to
    // approve their own record (人類監督與內控 §四).
    const conflicting = [version.preparedById, version.submittedById, version.reviewedById].filter(Boolean);
    if (conflicting.includes(user.id)) {
      throw new ApiError(403, "提報人、送出人或覆核人不得為最終核准人");
    }

    const isAdjustment = version.parentVersionId !== null;
    const finalStatus = isAdjustment ? "ADJUSTED" : "LOCKED";
    const now = new Date();

    const updated = await tx.budgetVersion.update({
      where: { id: versionId },
      data: {
        status: finalStatus,
        approvedById: user.id,
        approvedAt: now,
        lockedAt: now,
      },
    });

    await writeAuditLog(
      {
        actorUserId: user.id,
        action: "BUDGET_APPROVED",
        entityType: "BudgetVersion",
        entityId: versionId,
        beforeData: { status: version.status },
        afterData: { status: isAdjustment ? "ADJUSTED" : "APPROVED" },
      },
      tx
    );
    await writeAuditLog(
      {
        actorUserId: user.id,
        action: "BUDGET_LOCKED",
        entityType: "BudgetVersion",
        entityId: versionId,
        afterData: { status: finalStatus },
      },
      tx
    );

    const total = sumDecimals(version.lines.map((l) => l.nextYearTotal)) ?? ZERO;
    await tx.memoryEntry.create({
      data: {
        type: "PRIOR_YEAR_APPROVED_BUDGET",
        scopeDepartmentId: version.departmentId,
        fiscalYear: version.fiscalYear,
        source: `workflow:approve:${versionId}`,
        payload: { versionId, total: total.toString(), lineCount: version.lines.length },
        createdById: user.id,
        isUserDeletable: false,
      },
    });

    return updated;
  });
}

export async function rejectBudgetVersion(user: CurrentUser, versionId: string, reason: string) {
  await requireCapability(user, "budget.approve");
  if (!reason || reason.trim().length === 0) {
    throw new ApiError(422, "駁回必須填寫原因");
  }

  return prisma.$transaction(async (tx) => {
    const version = await loadVersionOrThrow(tx, versionId);
    assertTransition(version.status, "reject");
    if ([version.preparedById, version.submittedById].includes(user.id)) {
      throw new ApiError(403, "提報人或送出人不得為最終核准人");
    }

    const updated = await tx.budgetVersion.update({
      where: { id: versionId },
      data: { status: "REJECTED", rejectedAt: new Date(), rejectReason: reason },
    });

    await writeAuditLog(
      {
        actorUserId: user.id,
        action: "BUDGET_REJECTED",
        entityType: "BudgetVersion",
        entityId: versionId,
        reason,
        beforeData: { status: version.status },
        afterData: { status: updated.status },
      },
      tx
    );

    return updated;
  });
}

export async function requestAdjustment(user: CurrentUser, versionId: string, reason: string) {
  await requireCapability(user, "budget.adjustment.request");
  if (!reason || reason.trim().length === 0) {
    throw new ApiError(422, "正式預算調整申請必須填寫理由");
  }

  return prisma.$transaction(async (tx) => {
    const version = await loadVersionOrThrow(tx, versionId);
    await requireDepartmentAccess(user, version.departmentId);
    assertTransition(version.status, "requestAdjustment");

    const nextVersionNumber = version.versionNumber + 1;
    const child = await tx.budgetVersion.create({
      data: {
        departmentId: version.departmentId,
        fiscalYear: version.fiscalYear,
        versionNumber: nextVersionNumber,
        status: "ADJUSTMENT_PENDING",
        parentVersionId: version.id,
        preparedById: user.id,
        adjustmentReason: reason,
      },
    });

    for (const line of version.lines) {
      const newLine = await tx.budgetLine.create({
        data: {
          budgetVersionId: child.id,
          accountId: line.accountId,
          priorPriorYearActual: line.priorPriorYearActual,
          priorYearOriginalBudget: line.priorYearOriginalBudget,
          currentYearProjection: line.currentYearProjection,
          projectionIsComplete: line.projectionIsComplete,
          nextYearTargetExcludingNew: line.nextYearTargetExcludingNew,
          nextYearNewHireBudget: line.nextYearNewHireBudget,
          nextYearTotal: line.nextYearTotal,
          growthRateExcludingNew: line.growthRateExcludingNew,
          growthRateIncludingNew: line.growthRateIncludingNew,
          entryTypeSnapshot: line.entryTypeSnapshot,
          formulaStatus: line.formulaStatus,
          isLocked: line.isLocked,
        },
      });
      const monthly = await tx.budgetLineMonthlyActual.findMany({ where: { budgetLineId: line.id } });
      for (const m of monthly) {
        await tx.budgetLineMonthlyActual.create({
          data: {
            budgetLineId: newLine.id,
            year: m.year,
            month: m.month,
            amount: m.amount,
            isMissing: m.isMissing,
            source: m.source,
          },
        });
      }
    }

    await tx.memoryEntry.create({
      data: {
        type: "MANUAL_ADJUSTMENT",
        scopeDepartmentId: version.departmentId,
        fiscalYear: version.fiscalYear,
        source: `workflow:requestAdjustment:${child.id}`,
        payload: { parentVersionId: version.id, childVersionId: child.id, reason },
        createdById: user.id,
        isUserDeletable: false,
      },
    });

    await writeAuditLog(
      {
        actorUserId: user.id,
        action: "BUDGET_ADJUSTMENT_REQUESTED",
        entityType: "BudgetVersion",
        entityId: child.id,
        reason,
        beforeData: { parentVersionId: version.id, parentStatus: version.status },
        afterData: { childVersionId: child.id, status: child.status },
      },
      tx
    );

    return child;
  });
}
