import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { isAuthBypassEnabled } from "@/lib/env";
import { fetchFinanceDepartmentAndVersion } from "@/lib/reports/fetchFinanceVersion";
import { BudgetSummaryPreviewClient } from "./BudgetSummaryPreviewClient";

export const dynamic = "force-dynamic";

/**
 * Stage 1 layout preview of the eventual multi-department budget summary
 * report (see BudgetSummaryPreviewClient.tsx for the full contract). This
 * route - and its Dashboard entry point (see dashboard/page.tsx) - must
 * only ever be reachable under the exact same fail-closed gate as every
 * other Preview-only feature in this app (isAuthBypassEnabled(): hard-
 * blocked in Production regardless of any other setting, and requires both
 * VERCEL_ENV=preview and AUTH_DISABLED=true otherwise - see lib/env.ts).
 * Read-only: this page never writes to the database. It reads the single
 * real BudgetVersion this Preview environment might have for 財務管理處／
 * 17203 whose fiscalYear is exactly PREVIEW_TARGET_FISCAL_YEAR (2027), and
 * otherwise renders nothing but hand-typed representative department names
 * with "—" placeholders - no other Department/Account/BudgetVersion rows
 * are created, imported, or assumed to exist.
 *
 * The fetch itself (fetchFinanceDepartmentAndVersion) is shared verbatim
 * with the Excel/PDF export API route (see
 * lib/reports/fetchFinanceVersion.ts) - the web view and its exports can
 * never read a different BudgetVersion from each other.
 */
export default async function BudgetSummaryPreviewPage() {
  if (!isAuthBypassEnabled()) notFound();

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { financeDepartment, financeVersion } = await fetchFinanceDepartmentAndVersion();

  return <BudgetSummaryPreviewClient financeDepartment={financeDepartment} financeVersion={financeVersion} />;
}
