import { prisma } from "@/lib/prisma";
import { Decimal, toDecimal, ZERO } from "@/lib/money/decimal";
import type { FormulaStatus } from "@prisma/client";

/**
 * Formula expressions are stored as versioned, effective-dated JSON records
 * (FormulaDefinition.expression) rather than hardcoded, so business owners
 * can register/replace formulas (with a full history) through the
 * controlled admin workflow instead of a code change. See
 * docs/budget-system-spec-v0.4.md §2 for the documented formula shapes this
 * schema is designed to express (salary-multiple bonuses, per-employee flat
 * allowances, percentage-of-other-account provisions).
 *
 * IMPORTANT: no FormulaDefinition or SalaryDataSource rows are seeded by
 * this codebase. Until real business data is imported through the
 * FormulaDefinition / SalaryDataSource admin import flows, every FORMULA
 * account resolves to NOT_CONFIGURED - it must never silently compute as 0.
 */
export type FormulaExpression =
  | { kind: "salary_multiple"; months: number }
  | { kind: "per_employee_flat"; amountPerEmployee: number; months: number }
  | { kind: "percent_of_accounts"; accountCodes: string[]; rate: number };

export interface FormulaResult {
  status: FormulaStatus;
  amount: Decimal | null;
  reason?: string;
}

export async function resolveActiveFormula(formulaKey: string, fiscalYear: number) {
  const asOf = new Date(fiscalYear, 0, 1);
  return prisma.formulaDefinition.findFirst({
    where: {
      key: formulaKey,
      isActive: true,
      effectiveFrom: { lte: asOf },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
    },
    orderBy: { version: "desc" },
  });
}

async function getSalaryBasis(departmentId: string, fiscalYear: number) {
  // Uses the prior fiscal year's confirmed monthly salary data as the basis
  // for the next year's formula-driven accounts (bonuses etc. are computed
  // from the current known payroll level, per docs/budget-system-spec §2).
  const rows = await prisma.salaryDataSource.findMany({
    where: { departmentId, fiscalYear: fiscalYear - 1, isConfirmed: true },
  });
  if (rows.length === 0) return null;
  return rows;
}

export async function evaluateFormula(
  formulaKey: string,
  departmentId: string,
  fiscalYear: number,
  otherAccountAmounts: Map<string, Decimal>
): Promise<FormulaResult> {
  const definition = await resolveActiveFormula(formulaKey, fiscalYear);
  if (!definition) {
    return { status: "NOT_CONFIGURED", amount: null, reason: "尚未設定公式" };
  }

  const expr = definition.expression as unknown as FormulaExpression;

  switch (expr.kind) {
    case "salary_multiple": {
      const salaryRows = await getSalaryBasis(departmentId, fiscalYear);
      if (!salaryRows || salaryRows.length === 0) {
        return { status: "NOT_CONFIGURED", amount: null, reason: "薪資資料來源尚未設定" };
      }
      const latest = salaryRows.reduce((a, b) => (a.month > b.month ? a : b));
      const amount = toDecimal(latest.totalBaseSalary).times(expr.months);
      return { status: "CONFIGURED", amount };
    }
    case "per_employee_flat": {
      const salaryRows = await getSalaryBasis(departmentId, fiscalYear);
      if (!salaryRows || salaryRows.length === 0) {
        return { status: "NOT_CONFIGURED", amount: null, reason: "薪資資料來源尚未設定" };
      }
      const latest = salaryRows.reduce((a, b) => (a.month > b.month ? a : b));
      const amount = new Decimal(expr.amountPerEmployee).times(latest.employeeCount).times(expr.months);
      return { status: "CONFIGURED", amount };
    }
    case "percent_of_accounts": {
      let base = ZERO;
      for (const code of expr.accountCodes) {
        const value = otherAccountAmounts.get(code);
        if (value === undefined) {
          return {
            status: "NOT_CONFIGURED",
            amount: null,
            reason: `依賴科目 ${code} 尚未計算完成`,
          };
        }
        base = base.plus(value);
      }
      return { status: "CONFIGURED", amount: base.times(expr.rate) };
    }
    default:
      return { status: "NOT_CONFIGURED", amount: null, reason: "未知的公式類型" };
  }
}
