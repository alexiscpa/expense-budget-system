import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { Decimal, toDecimal, growthRate, isNegative } from "@/lib/money/decimal";
import type { CurrentUser } from "@/lib/auth/session";
import { requireCapability, requireDepartmentAccess, ApiError } from "@/lib/rbac/guard";
import { isEditable } from "@/lib/workflow/stateMachine";
import { writeAuditLog } from "@/lib/audit/log";
import { evaluateFormula } from "@/lib/formula/engine";
import { isTestBypassUser } from "@/lib/auth/testBypass";

export interface DerivedFields {
  nextYearTotal: Decimal;
  growthRateExcludingNew: Decimal | null;
  growthRateIncludingNew: Decimal | null;
}

export function deriveLineTotals(params: {
  priorYearOriginalBudget: Decimal.Value;
  nextYearTargetExcludingNew: Decimal.Value;
  nextYearNewHireBudget: Decimal.Value;
}): DerivedFields {
  const excludingNew = toDecimal(params.nextYearTargetExcludingNew);
  const newHire = toDecimal(params.nextYearNewHireBudget);
  const nextYearTotal = excludingNew.plus(newHire);
  const base = toDecimal(params.priorYearOriginalBudget);
  return {
    nextYearTotal,
    growthRateExcludingNew: growthRate(base, excludingNew),
    growthRateIncludingNew: growthRate(base, nextYearTotal),
  };
}

/**
 * Creates a DRAFT BudgetVersion (versionNumber 1) for a department/fiscal
 * year and materializes one BudgetLine per active Account. FORMULA and
 * NOT_BUDGETED accounts are locked immediately; DEPARTMENT_INPUT lines start
 * at 0 pending manual entry. Prior-period figures (實績/目標/推移) must be
 * populated separately via the budget-line import flow using real actuals -
 * they are never fabricated here.
 */
export async function createBudgetVersionDraft(user: CurrentUser, departmentId: string, fiscalYear: number) {
  await requireCapability(user, "budget.edit_own_department");
  await requireDepartmentAccess(user, departmentId);

  const existing = await prisma.budgetVersion.findFirst({
    where: { departmentId, fiscalYear, versionNumber: 1 },
  });
  if (existing) throw new ApiError(409, "此部門年度預算草稿已存在");

  const accounts = await prisma.account.findMany({ where: { isActive: true } });
  if (accounts.length === 0) {
    throw new ApiError(422, "會計科目主檔尚未匯入，請聯絡財務管理員先完成科目主檔匯入");
  }

  return prisma.$transaction(async (tx) => {
    const version = await tx.budgetVersion.create({
      data: {
        departmentId,
        fiscalYear,
        versionNumber: 1,
        status: "DRAFT",
        // TEST_BYPASS_USER is a virtual identity never written to the User
        // table (see lib/auth/testBypass.ts), so its sentinel id must never
        // be written into this real foreign key - recorded as NULL here,
        // exactly as writeAuditLog() already does for actorUserId.
        preparedById: isTestBypassUser(user) ? null : user.id,
      },
    });

    // Set explicitly (rather than relying on @default(now())/@updatedAt at
    // the DB layer) so every freshly created line has createdAt and
    // updatedAt equal to the exact same JS Date value, not two independent
    // "now" evaluations (client-side vs the Postgres server) that could
    // differ by a few milliseconds. The UI uses this exact equality to
    // decide whether a 2026 amount field has ever been saved by a user -
    // see BudgetVersionClient.tsx.
    const createdAt = new Date();

    for (const account of accounts) {
      let formulaStatus: "NOT_APPLICABLE" | "CONFIGURED" | "NOT_CONFIGURED" = "NOT_APPLICABLE";
      let excludingNew = new Decimal(0);
      const isLocked = account.entryType !== "DEPARTMENT_INPUT";

      if (account.entryType === "FORMULA") {
        if (!account.formulaKey) {
          formulaStatus = "NOT_CONFIGURED";
        } else {
          const result = await evaluateFormula(account.formulaKey, departmentId, fiscalYear, new Map());
          formulaStatus = result.status;
          if (result.status === "CONFIGURED" && result.amount) {
            excludingNew = result.amount;
          }
        }
      }

      // When the account carries a known prior-year reference amount (set
      // via a controlled import - see Account.priorYearReferenceAmount),
      // seed both read-only reference columns from it instead of leaving
      // them at 0/"資料不全，待確認": it doubles as the account's most
      // recently known "原核定預算" (目標) AND "全年推估數" (推移) for a
      // department that has not yet had a full multi-column prior-year
      // import - the same real figure, never a fabricated second number.
      const referenceAmount = account.priorYearReferenceAmount;
      const priorYearOriginalBudget = referenceAmount ?? new Decimal(0);
      const derived = deriveLineTotals({
        priorYearOriginalBudget,
        nextYearTargetExcludingNew: excludingNew,
        nextYearNewHireBudget: 0,
      });

      await tx.budgetLine.create({
        data: {
          budgetVersionId: version.id,
          accountId: account.id,
          priorPriorYearActual: 0,
          priorYearOriginalBudget,
          currentYearProjection: referenceAmount ?? null,
          projectionIsComplete: referenceAmount !== null,
          nextYearTargetExcludingNew: excludingNew,
          nextYearNewHireBudget: 0,
          nextYearTotal: derived.nextYearTotal,
          growthRateExcludingNew: derived.growthRateExcludingNew,
          growthRateIncludingNew: derived.growthRateIncludingNew,
          entryTypeSnapshot: account.entryType,
          formulaStatus,
          isLocked,
          createdAt,
          updatedAt: createdAt,
        },
      });
    }

    await writeAuditLog(
      {
        actorUserId: user.id,
        action: "BUDGET_VERSION_CREATED",
        entityType: "BudgetVersion",
        entityId: version.id,
        afterData: { departmentId, fiscalYear },
      },
      tx
    );

    return version;
  });
}

export async function updateDepartmentInputLine(
  user: CurrentUser,
  versionId: string,
  lineId: string,
  input: { nextYearTargetExcludingNew: string; nextYearNewHireBudget: string; justification?: string | null }
) {
  await requireCapability(user, "budget.edit_own_department");

  return prisma.$transaction(async (tx) => {
    const version = await tx.budgetVersion.findUnique({ where: { id: versionId } });
    if (!version) throw new ApiError(404, "找不到此預算版本");
    await requireDepartmentAccess(user, version.departmentId);

    if (!isEditable(version.status)) {
      throw new ApiError(409, "送出後填報人不得直接修改，必須由財務退回後才能修改");
    }

    const line = await tx.budgetLine.findUnique({ where: { id: lineId } });
    if (!line || line.budgetVersionId !== versionId) throw new ApiError(404, "找不到此科目資料");
    if (line.isLocked) {
      throw new ApiError(422, "此科目為公式計算或不編列科目，不可手動修改");
    }

    const excludingNew = new Decimal(input.nextYearTargetExcludingNew || "0");
    const newHire = new Decimal(input.nextYearNewHireBudget || "0");
    if (isNegative(excludingNew) || isNegative(newHire)) {
      throw new ApiError(422, "金額不可為負數");
    }

    const derived = deriveLineTotals({
      priorYearOriginalBudget: line.priorYearOriginalBudget,
      nextYearTargetExcludingNew: excludingNew,
      nextYearNewHireBudget: newHire,
    });

    // undefined = caller didn't touch this field, leave as-is; "" (after
    // trim) = explicitly cleared; anything else = the new note. Users may
    // only ever change the 2026 amount and this note - never the account
    // name/code/category, which come solely from master data.
    const trimmedJustification = input.justification?.trim();
    const justification = input.justification === undefined ? undefined : trimmedJustification === "" ? null : trimmedJustification;

    const updated = await tx.budgetLine.update({
      where: { id: lineId },
      data: {
        nextYearTargetExcludingNew: excludingNew,
        nextYearNewHireBudget: newHire,
        nextYearTotal: derived.nextYearTotal,
        growthRateExcludingNew: derived.growthRateExcludingNew,
        growthRateIncludingNew: derived.growthRateIncludingNew,
        justification,
      },
    });

    await writeAuditLog(
      {
        actorUserId: user.id,
        action: "BUDGET_LINE_UPDATED",
        entityType: "BudgetLine",
        entityId: lineId,
        beforeData: {
          nextYearTargetExcludingNew: line.nextYearTargetExcludingNew.toString(),
          nextYearNewHireBudget: line.nextYearNewHireBudget.toString(),
          justification: line.justification,
        },
        afterData: {
          nextYearTargetExcludingNew: updated.nextYearTargetExcludingNew.toString(),
          nextYearNewHireBudget: updated.nextYearNewHireBudget.toString(),
          justification: updated.justification,
        },
      },
      tx as Prisma.TransactionClient
    );

    return updated;
  });
}
