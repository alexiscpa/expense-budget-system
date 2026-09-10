import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getAccessibleDepartmentIds, hasCapability } from "@/lib/rbac/permissions";
import { isTestBypassUser } from "@/lib/auth/testBypass";
import { loadStage2bProgress } from "@/lib/reports/stage2bProgress";
import { Stage2bProgressSummaryCards } from "../Stage2bProgressSummaryCards";
import { Stage2bProgressTable } from "../Stage2bProgressTable";

export const dynamic = "force-dynamic";

/**
 * Full 45-department Stage 2B-2 progress detail page - the destination of
 * the Dashboard home page's "查看部門明細" link (see
 * Stage2bProgressCompactSummary.tsx). Everything the home page used to
 * show inline (the 8 status cards, the 3 ratio cards, the category/
 * domestic-overseas/status filters, and the full per-department table with
 * amounts/headcounts/confirmed-line-counts/workflow status/last-prepared
 * date/action buttons) now lives here instead, so the home page stays a
 * short glance-and-go summary.
 *
 * RBAC is identical to what the home page enforced before this split -
 * never widened: a company-wide viewer (budget.view_any capability or
 * companyWide=true) sees all 45 roster rows; anyone else sees only the
 * rows for departments they are actually authorized on, exactly like
 * getAccessibleDepartmentIds already scopes every other budget query in
 * this app. A department-scoped user can still reach this URL directly,
 * but never sees another department's row or the company-wide summary
 * cards - the "查看部門明細" entry point on the home page is simply never
 * shown to them in the first place (see dashboard/page.tsx).
 */
export default async function BudgetProgressPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const accessibleDepartmentIds = await getAccessibleDepartmentIds(user);
  const canViewAllDepartments = hasCapability(user.role, "budget.view_any") || user.companyWide;
  const canStartPreparation = hasCapability(user.role, "budget.edit_own_department") || isTestBypassUser(user);

  const { rows: stage2bRows, summary: stage2bSummary } = await loadStage2bProgress();
  const visibleStage2bRows = canViewAllDepartments
    ? stage2bRows
    : stage2bRows.filter((r) => r.departmentId !== null && accessibleDepartmentIds?.includes(r.departmentId));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Link href="/dashboard" className="mb-4 inline-block text-sm text-brand-600 hover:underline">
        ← 回到預算總覽
      </Link>

      <h1 className="mb-6 text-xl font-bold">2027年度預算編製進度 - 部門明細</h1>

      {canViewAllDepartments && <Stage2bProgressSummaryCards summary={stage2bSummary} />}
      <Stage2bProgressTable rows={visibleStage2bRows} canStartPreparation={canStartPreparation} />

      <Link href="/dashboard" className="mt-6 inline-block text-sm text-brand-600 hover:underline">
        ← 回到預算總覽
      </Link>
    </main>
  );
}
