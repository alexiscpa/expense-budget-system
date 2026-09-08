import "server-only";
import { prisma } from "@/lib/prisma";
import { DEMO_DEPARTMENT_CODE } from "@/lib/demo/constants";
import { PREVIEW_TARGET_FISCAL_YEAR } from "@/lib/reports/budgetSummaryPreviewData";
import type { FinanceVersionDto } from "@/lib/reports/summaryReportData";

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
