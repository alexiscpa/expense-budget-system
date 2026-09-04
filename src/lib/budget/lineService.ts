import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { Decimal, toDecimal, growthRate, isNegative } from "@/lib/money/decimal";
import type { CurrentUser } from "@/lib/auth/session";
import { requireCapability, requireDepartmentAccess, ApiError } from "@/lib/rbac/guard";
import { isEditable } from "@/lib/workflow/stateMachine";
import { writeAuditLog } from "@/lib/audit/log";
import { evaluateFormula } from "@/lib/formula/engine";

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
      data: { departmentId, fiscalYear, versionNumber: 1, status: "DRAFT", preparedById: user.id },
    });

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

      const derived = deriveLineTotals({
        priorYearOriginalBudget: 0,
        nextYearTargetExcludingNew: excludingNew,
        nextYearNewHireBudget: 0,
      });

      await tx.budgetLine.create({
        data: {
          budgetVersionId: version.id,
          accountId: account.id,
          priorPriorYearActual: 0,
          priorYearOriginalBudget: 0,
          currentYearProjection: null,
          projectionIsComplete: false,
          nextYearTargetExcludingNew: excludingNew,
          nextYearNewHireBudget: 0,
          nextYearTotal: derived.nextYearTotal,
          growthRateExcludingNew: derived.growthRateExcludingNew,
          growthRateIncludingNew: derived.growthRateIncludingNew,
          entryTypeSnapshot: account.entryType,
          formulaStatus,
          isLocked,
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
  input: { nextYearTargetExcludingNew: string; nextYearNewHireBudget: string }
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

    const updated = await tx.budgetLine.update({
      where: { id: lineId },
      data: {
        nextYearTargetExcludingNew: excludingNew,
        nextYearNewHireBudget: newHire,
        nextYearTotal: derived.nextYearTotal,
        growthRateExcludingNew: derived.growthRateExcludingNew,
        growthRateIncludingNew: derived.growthRateIncludingNew,
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
        },
        afterData: {
          nextYearTargetExcludingNew: updated.nextYearTargetExcludingNew.toString(),
          nextYearNewHireBudget: updated.nextYearNewHireBudget.toString(),
        },
      },
      tx as Prisma.TransactionClient
    );

    return updated;
  });
}
