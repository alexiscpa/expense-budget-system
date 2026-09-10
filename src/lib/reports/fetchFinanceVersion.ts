import "server-only";
import { prisma } from "@/lib/prisma";
import { DEMO_DEPARTMENT_CODE } from "@/lib/demo/constants";
import { PREVIEW_TARGET_FISCAL_YEAR } from "@/lib/reports/budgetSummaryPreviewData";
import type { FinanceVersionDto } from "@/lib/reports/summaryReportData";
import type { DeptSummaryEntry } from "@/lib/reports/multiDepartmentSummary";

/**
 * The single, shared query behind the budget summary preview - used by
 * page.tsx (for the on-screen render) AND the export API route, so a web
 * view and its Excel/PDF export can never read a different BudgetVersion
 * from each other. Deliberately scoped to fiscalYear=PREVIEW_TARGET_FISCAL_YEAR
 * only (see budgetSummaryPreviewData.ts) - an existing fiscalYear=2026 (or
 * any other year) version must never be picked up here. Read-only.
 */
export async function fetchFinanceDepartmentAndVersion(): Promise<{
  financeDepartment: { code: string; name: string } | null;
  financeVersion: FinanceVersionDto | null;
}> {
  const financeDepartment = await prisma.department.findUnique({ where: { code: DEMO_DEPARTMENT_CODE } });

  const financeVersion = financeDepartment
    ? await prisma.budgetVersion.findFirst({
        where: { departmentId: financeDepartment.id, fiscalYear: PREVIEW_TARGET_FISCAL_YEAR },
        orderBy: [{ versionNumber: "desc" }, { updatedAt: "desc" }],
        include: { lines: { include: { account: true } } },
      })
    : null;

  const serializedVersion: FinanceVersionDto | null = financeVersion
    ? JSON.parse(
        JSON.stringify(financeVersion, (_k, v) => (typeof v === "object" && v !== null && "toFixed" in v ? v.toString() : v))
      )
    : null;

  return {
    financeDepartment: financeDepartment ? { code: financeDepartment.code, name: financeDepartment.name } : null,
    financeVersion: serializedVersion,
  };
}

/**
 * Multi-department query behind the on-screen budget summary preview only
 * (never used by the Excel/PDF export routes, which keep reading
 * fetchFinanceDepartmentAndVersion above unchanged) - looks up every
 * department by its real code (Stage 2A's 8 test departments plus
 * 財務管理處) instead of hard-coding a single one, so the preview can show
 * each department's own fiscalYear=PREVIEW_TARGET_FISCAL_YEAR (2027)
 * BudgetVersion/lines - or "未編製" when none exists yet - regardless of
 * that version's status (DRAFT included) or whether its 2027 columns have
 * been filled in. Read-only; a department code with no matching row is
 * simply absent from the returned array (never fabricated).
 */
export async function fetchDeptSummaryEntries(codes: readonly string[]): Promise<DeptSummaryEntry[]> {
  const departments = await prisma.department.findMany({ where: { code: { in: [...codes] } } });
  if (departments.length === 0) return [];

  const versions = await prisma.budgetVersion.findMany({
    where: { departmentId: { in: departments.map((d) => d.id) }, fiscalYear: PREVIEW_TARGET_FISCAL_YEAR },
    orderBy: [{ versionNumber: "desc" }, { updatedAt: "desc" }],
    include: { lines: { include: { account: true } } },
  });
  const versionByDeptId = new Map(versions.map((v) => [v.departmentId, v]));

  const entries = departments.map((d) => ({
    code: d.code,
    name: d.name,
    class: d.class,
    isTestData: d.isTestData,
    version: versionByDeptId.get(d.id) ?? null,
  }));

  // Decimal/Date -> string, the same generic serialization used everywhere
  // else in this app (see fetchFinanceDepartmentAndVersion above).
  return JSON.parse(
    JSON.stringify(entries, (_k, v) => (typeof v === "object" && v !== null && "toFixed" in v ? v.toString() : v))
  ) as DeptSummaryEntry[];
}
