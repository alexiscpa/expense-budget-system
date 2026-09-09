import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { isAuthBypassEnabled } from "@/lib/env";
import { fetchFinanceDepartmentAndVersion, fetchDeptSummaryEntries } from "@/lib/reports/fetchFinanceVersion";
import { KNOWN_DEPARTMENT_CODES } from "@/lib/reports/budgetSummaryPreviewData";
import { BudgetSummaryPreviewClient } from "./BudgetSummaryPreviewClient";

export const dynamic = "force-dynamic";

/**
 * Multi-department budget summary preview (see BudgetSummaryPreviewClient.tsx
 * for the full contract). This route - and its Dashboard entry point (see
 * dashboard/page.tsx) - must only ever be reachable under the exact same
 * fail-closed gate as every other Preview-only feature in this app
 * (isAuthBypassEnabled(): hard-blocked in Production regardless of any
 * other setting, and requires both VERCEL_ENV=preview and
 * AUTH_DISABLED=true otherwise - see lib/env.ts). Read-only: this page
 * never writes to the database.
 *
 * Two independent, deliberately separate fetches:
 *  - fetchFinanceDepartmentAndVersion() - 財務管理處 only, unchanged, still
 *    shared verbatim with the Excel/PDF export API route (see
 *    lib/reports/fetchFinanceVersion.ts) so the web view's export links and
 *    that route can never disagree about 財務管理處's own figures. Export
 *    has not been extended beyond 財務管理處 this round.
 *  - fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES) - every other real,
 *    code-addressable department (Stage 2A's 8 test departments), used only
 *    by the on-screen tabs. A department name in UNIT_BLOCKS with no known
 *    code stays a hand-typed representative placeholder rendering "—" - no
 *    Department/Account/BudgetVersion row is created, imported, or assumed
 *    to exist for those.
 */
export default async function BudgetSummaryPreviewPage() {
  if (!isAuthBypassEnabled()) notFound();

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [{ financeDepartment, financeVersion }, deptEntries] = await Promise.all([
    fetchFinanceDepartmentAndVersion(),
    fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES),
  ]);

  return (
    <BudgetSummaryPreviewClient
      financeDepartment={financeDepartment}
      financeVersion={financeVersion}
      deptEntries={deptEntries}
    />
  );
}
