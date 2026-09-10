import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import type { CurrentUser } from "@/lib/auth/session";
import { requireCapability, requireDepartmentAccess, ApiError } from "@/lib/rbac/guard";
import { assertTransition } from "@/lib/workflow/stateMachine";
import { writeAuditLog, buildAuditLogData } from "@/lib/audit/log";
import { sumDecimals, ZERO } from "@/lib/money/decimal";
import { isTestBypassUser } from "@/lib/auth/testBypass";

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

    // TEST_BYPASS_USER is never written to the User table (see
    // lib/auth/testBypass.ts) - these actor-tracking foreign keys are
    // recorded as NULL for it, exactly as writeAuditLog() already does for
    // actorUserId, to avoid violating the FK constraint.
    const actorId = isTestBypassUser(user) ? null : user.id;
    const updated = await tx.budgetVersion.update({
      where: { id: versionId },
      data: {
        status: "SUBMITTED",
        preparedById: version.preparedById ?? actorId,
        submittedById: actorId,
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

/**
 * 撤回修改 (withdraw submission): SUBMITTED -> DRAFT, so the preparer's own
 * department can fix a figure and re-submit, without the finance reviewer
 * having to "return" it first. Gated by budget.edit_own_department (the
 * same capability that edits lines/headcount) + requireDepartmentAccess -
 * "只有原編製部門及具預算編製權限者可以撤回" - never budget.submit_own_department,
 * since this is a step backwards into editing, not a submission action.
 * TEST_BYPASS_USER already carries this capability in Preview (see
 * lib/rbac/guard.ts), so this is usable there without any special-casing.
 *
 * Once review has actually started (UNDER_REVIEW), the department can no
 * longer pull the version back unilaterally - segregation of duties means
 * only the reviewer can send it back (via returnBudgetVersion) at that
 * point. That specific, more useful error is surfaced here rather than the
 * generic InvalidTransitionError the assertTransition() call below would
 * otherwise produce, since UNDER_REVIEW is deliberately not one of the
 * `withdraw` rows in TRANSITIONS.
 *
 * Never deletes/recreates the BudgetVersion or any BudgetLine - only the
 * `status` column changes, so every amount, 部門人數, 編列依據, and the
 * versionNumber are left completely untouched.
 */
export async function withdrawBudgetSubmission(user: CurrentUser, versionId: string) {
  await requireCapability(user, "budget.edit_own_department");

  return prisma.$transaction(async (tx) => {
    const version = await loadVersionOrThrow(tx, versionId);
    await requireDepartmentAccess(user, version.departmentId);

    if (version.status === "UNDER_REVIEW") {
      throw new ApiError(409, "預算已進入審核程序，無法自行撤回，請由審核人員退回修改。");
    }
    assertTransition(version.status, "withdraw");

    const updated = await tx.budgetVersion.update({
      where: { id: versionId },
      data: { status: "DRAFT" },
    });

    await writeAuditLog(
      {
        actorUserId: user.id,
        action: "BUDGET_SUBMISSION_WITHDRAWN",
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
      data: {
        status: "RETURNED",
        returnedAt: new Date(),
        returnReason: reason,
        // A finance-reviewer return means something needs to change before
        // this version is ready again - any prior "完成編製" mark no
        // longer reflects reality, so the preparer must re-run
        // completePreparation after addressing the return reason. Mirrors
        // the same clear-on-real-change rule in
        // updateDepartmentInputLine/updateBudgetYearHeadcount.
        preparationCompletedAt: null,
        preparationCompletedById: null,
      },
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
      data: {
        status: "SUBMITTED",
        submittedById: isTestBypassUser(user) ? null : user.id,
        submittedAt: new Date(),
      },
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

/**
 * Copies every BudgetLine (and each line's BudgetLineMonthlyActual rows)
 * from the parent version into a new ADJUSTMENT_PENDING child version.
 *
 * Previously this looped over every line inside an interactive
 * `prisma.$transaction(async (tx) => ...)`, awaiting one `budgetLine.create`
 * plus one `budgetLineMonthlyActual.findMany` per line, plus one
 * `budgetLineMonthlyActual.create` per monthly row found - for a 62-line
 * department with even a modest amount of monthly actuals history, that is
 * hundreds of sequential round trips in one transaction, the same class of
 * bug that caused P2028 ("Transaction already closed") in
 * createBudgetVersionDraft (see that function's comment for the general
 * pattern). Rewritten the same way: the parent version/lines and all of
 * their monthly actuals are read up front with exactly 2 queries (the
 * per-line `findMany` loop is replaced by a single `findMany` with
 * `budgetLineId: { in: [...] }`, grouped in memory), then the write is 4
 * statements - version insert, lines `createMany`, monthly-actuals
 * `createMany`, memory entry insert, audit log insert - sent together as a
 * non-interactive Prisma batch transaction with no client-side timeout.
 */
export async function requestAdjustment(user: CurrentUser, versionId: string, reason: string) {
  await requireCapability(user, "budget.adjustment.request");
  if (!reason || reason.trim().length === 0) {
    throw new ApiError(422, "正式預算調整申請必須填寫理由");
  }

  const version = await prisma.budgetVersion.findUnique({ where: { id: versionId }, include: { lines: true } });
  if (!version) throw new ApiError(404, "找不到此預算版本");
  await requireDepartmentAccess(user, version.departmentId);
  assertTransition(version.status, "requestAdjustment");

  const childId = randomUUID();
  const nextVersionNumber = version.versionNumber + 1;

  const monthlyActuals = version.lines.length
    ? await prisma.budgetLineMonthlyActual.findMany({
        where: { budgetLineId: { in: version.lines.map((l) => l.id) } },
      })
    : [];
  const monthlyByLine = new Map<string, typeof monthlyActuals>();
  for (const m of monthlyActuals) {
    const list = monthlyByLine.get(m.budgetLineId);
    if (list) list.push(m);
    else monthlyByLine.set(m.budgetLineId, [m]);
  }

  const lineIdMap = new Map<string, string>(); // parent line id -> child line id
  const lineRows: Prisma.BudgetLineCreateManyInput[] = version.lines.map((line) => {
    const newId = randomUUID();
    lineIdMap.set(line.id, newId);
    return {
      id: newId,
      budgetVersionId: childId,
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
    };
  });

  const monthlyRows: Prisma.BudgetLineMonthlyActualCreateManyInput[] = [];
  for (const line of version.lines) {
    const newLineId = lineIdMap.get(line.id)!;
    for (const m of monthlyByLine.get(line.id) ?? []) {
      monthlyRows.push({
        id: randomUUID(),
        budgetLineId: newLineId,
        year: m.year,
        month: m.month,
        amount: m.amount,
        isMissing: m.isMissing,
        source: m.source,
      });
    }
  }

  const versionCreateQuery = prisma.budgetVersion.create({
    data: {
      id: childId,
      departmentId: version.departmentId,
      fiscalYear: version.fiscalYear,
      versionNumber: nextVersionNumber,
      status: "ADJUSTMENT_PENDING",
      parentVersionId: version.id,
      preparedById: user.id,
      adjustmentReason: reason,
      // A fresh 編製 cycle starts the moment this adjustment child version
      // is materialized from its parent's content - same convention as
      // createBudgetVersionDraft (lib/budget/lineService.ts).
      lastPreparedAt: new Date(),
    },
  });
  const linesCreateManyQuery = prisma.budgetLine.createMany({ data: lineRows });
  const monthlyCreateManyQuery = prisma.budgetLineMonthlyActual.createMany({ data: monthlyRows });
  const memoryEntryQuery = prisma.memoryEntry.create({
    data: {
      type: "MANUAL_ADJUSTMENT",
      scopeDepartmentId: version.departmentId,
      fiscalYear: version.fiscalYear,
      source: `workflow:requestAdjustment:${childId}`,
      payload: { parentVersionId: version.id, childVersionId: childId, reason },
      createdById: user.id,
      isUserDeletable: false,
    },
  });
  const auditLogQuery = prisma.auditLog.create({
    data: buildAuditLogData({
      actorUserId: user.id,
      action: "BUDGET_ADJUSTMENT_REQUESTED",
      entityType: "BudgetVersion",
      entityId: childId,
      reason,
      beforeData: { parentVersionId: version.id, parentStatus: version.status },
      afterData: { childVersionId: childId, status: "ADJUSTMENT_PENDING" },
    }),
  });

  try {
    const [child] = await prisma.$transaction([
      versionCreateQuery,
      linesCreateManyQuery,
      monthlyCreateManyQuery,
      memoryEntryQuery,
      auditLogQuery,
    ]);
    return child;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Race: another request created versionNumber `nextVersionNumber` for
      // this department/fiscalYear between the read above and this write -
      // the @@unique([departmentId, fiscalYear, versionNumber]) constraint
      // caught it. The whole batch rolled back atomically, so nothing was
      // left behind.
      throw new ApiError(409, "此預算版本已被其他請求調整，請重新整理後再試");
    }
    throw err;
  }
}
