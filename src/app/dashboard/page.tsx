import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getAccessibleDepartmentIds, hasCapability } from "@/lib/rbac/permissions";
import { isTestBypassUser } from "@/lib/auth/testBypass";
import { isAuthBypassEnabled } from "@/lib/env";
import { getDemoSeedStatus } from "@/lib/demo/seedDemoMasterData";
import { DEMO_FISCAL_YEAR } from "@/lib/demo/constants";
import { getStage2ASeedStatus } from "@/lib/testdata/stage2aSeed";
import { DemoSeedPanel } from "./DemoSeedPanel";
import { Stage2ASeedPanel } from "./Stage2ASeedPanel";
import { CreateBudgetVersionForm } from "./CreateBudgetVersionForm";
import { BudgetOwnerInitPanel } from "./BudgetOwnerInitPanel";
import { Stage2bProgressCompactSummary } from "./Stage2bProgressCompactSummary";
import { DepartmentSwitcher } from "./DepartmentSwitcher";
import { formatTaipeiDate } from "@/lib/format/date";
import { isVercelProductionEnvironment } from "@/lib/env";
import { loadStage2bProgress } from "@/lib/reports/stage2bProgress";
import { BUDGET_OWNER_ROSTER } from "@/lib/masterdata/budgetOwnerRoster";
import { ACTIVE_DEPARTMENT_COOKIE } from "@/lib/session/activeDepartmentCookie";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "已送出",
  UNDER_REVIEW: "財務覆核中",
  RETURNED: "已退回",
  APPROVED: "已核准",
  LOCKED: "已鎖定",
  ADJUSTMENT_PENDING: "調整編製中",
  ADJUSTED: "已調整核定",
  REJECTED: "已駁回",
};

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const accessibleDepartmentIds = await getAccessibleDepartmentIds(user);

  // "目前檢視部門" (multi-department switching, Stage 2B-3 三部門邀請登入
  // Pilot) - the cookie is a display preference only (see
  // /api/session/active-department's own doc comment), so it is re-validated
  // against the caller's REAL accessible departments on every render rather
  // than trusted as-is: a cookie value for a department the caller has since
  // lost access to (or never had) is silently ignored, never honored.
  const requestedActiveDepartmentId = cookies().get(ACTIVE_DEPARTMENT_COOKIE)?.value ?? null;
  const activeDepartmentId =
    requestedActiveDepartmentId && (accessibleDepartmentIds === null || accessibleDepartmentIds.includes(requestedActiveDepartmentId))
      ? requestedActiveDepartmentId
      : null;

  const versions = await prisma.budgetVersion.findMany({
    where: {
      departmentId: activeDepartmentId
        ? activeDepartmentId
        : accessibleDepartmentIds === null
          ? undefined
          : { in: accessibleDepartmentIds },
    },
    include: { department: true },
    orderBy: [{ fiscalYear: "desc" }, { versionNumber: "desc" }],
    take: 100,
  });

  const bypassActive = isAuthBypassEnabled();
  const canCreateDraft = hasCapability(user.role, "budget.edit_own_department") || isTestBypassUser(user);
  // Fetched whenever the caller is department-scoped (not company-wide) -
  // both to populate CreateBudgetVersionForm's dropdown (canCreateDraft
  // viewers) and to drive DepartmentSwitcher (any scoped viewer with more
  // than one accessible department, canCreateDraft or not).
  const departmentOptions =
    accessibleDepartmentIds !== null && accessibleDepartmentIds.length > 0
      ? await prisma.department.findMany({
          where: { isActive: true, id: { in: accessibleDepartmentIds } },
          select: { id: true, code: true, name: true },
          orderBy: { code: "asc" },
        })
      : [];
  const demoSeedStatus = bypassActive ? await getDemoSeedStatus() : null;
  const stage2aSeedStatus = bypassActive ? await getStage2ASeedStatus() : null;

  // 45-department Stage 2B-2 progress: company-wide finance/admin viewers
  // see every department (summary + full detail table); a department-
  // scoped user (BUDGET_OWNER/DEPARTMENT_EDITOR/DEPARTMENT_REVIEWER) sees
  // only the rows for departments they are actually authorized on - never
  // the company-wide summary numbers, and never another department's row.
  const canViewAllDepartments = hasCapability(user.role, "budget.view_any") || user.companyWide;
  const canManageMasterData = hasCapability(user.role, "master_data.import");
  const { rows: stage2bRows, summary: stage2bSummary } = await loadStage2bProgress();
  const missingRosterCount = stage2bRows.filter((r) => !r.departmentExists).length;
  const showMasterDataInitPanel = canManageMasterData && !isVercelProductionEnvironment();

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">預算版本總覽</h1>
        <form action="/api/auth/logout" method="post">
          <span className="mr-3 text-sm text-slate-500">
            {user.name}（{user.role}）
          </span>
        </form>
      </div>

      {bypassActive && <DemoSeedPanel initialStatus={demoSeedStatus} />}
      {bypassActive && <Stage2ASeedPanel initialStatus={stage2aSeedStatus} />}

      {hasCapability(user.role, "user.manage") && (
        <p className="mb-4">
          <Link href="/dashboard/invitations" className="text-sm text-brand-600 hover:underline">
            部門邀請管理（Pilot 測試）→
          </Link>
        </p>
      )}

      {showMasterDataInitPanel && (
        <BudgetOwnerInitPanel missingCount={missingRosterCount} rosterSize={BUDGET_OWNER_ROSTER.length} />
      )}

      {departmentOptions.length > 1 && (
        <DepartmentSwitcher departments={departmentOptions} activeDepartmentId={activeDepartmentId} />
      )}

      {canViewAllDepartments && (
        <section className="mb-10">
          <Stage2bProgressCompactSummary summary={stage2bSummary} />
        </section>
      )}

      {bypassActive && (
        <div className="mb-8 rounded border border-indigo-300 bg-indigo-50 p-4">
          <p className="mb-1 text-sm font-semibold text-indigo-900">費用預算彙總表（版型預覽）</p>
          <p className="mb-3 text-xs text-indigo-700">
            版型預覽：目前僅財務管理處為實際測試資料，其他部門尚未匯入。
          </p>
          <Link
            href="/dashboard/reports/budget-summary-preview"
            className="inline-block rounded bg-indigo-600 px-4 py-2 text-sm text-white hover:bg-indigo-700"
          >
            開啟彙總表版型預覽
          </Link>
        </div>
      )}
      {canCreateDraft && (
        <CreateBudgetVersionForm
          departments={departmentOptions}
          defaultFiscalYear={bypassActive ? DEMO_FISCAL_YEAR : undefined}
        />
      )}

      <table className="w-full border-collapse overflow-hidden rounded border border-slate-200 text-sm">
        <thead className="bg-slate-100 text-left">
          <tr>
            <th className="px-3 py-2">部門</th>
            <th className="px-3 py-2">年度</th>
            <th className="px-3 py-2">版本</th>
            <th className="px-3 py-2">狀態</th>
            <th className="px-3 py-2">最後編製日期</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.id} className="border-t border-slate-200">
              <td className="px-3 py-2">
                {v.department.code} - {v.department.name}
                {bypassActive && (
                  <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800">測試資料</span>
                )}
              </td>
              <td className="px-3 py-2">{v.fiscalYear}</td>
              <td className="px-3 py-2">v{v.versionNumber}</td>
              <td className="px-3 py-2">{STATUS_LABEL[v.status] ?? v.status}</td>
              <td className="px-3 py-2">{formatTaipeiDate(v.lastPreparedAt)}</td>
              <td className="px-3 py-2">
                <Link href={`/dashboard/budgets/${v.id}`} className="text-brand-600 hover:underline">
                  查看
                </Link>
              </td>
            </tr>
          ))}
          {versions.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-slate-400">
                目前沒有可查看的預算版本
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
