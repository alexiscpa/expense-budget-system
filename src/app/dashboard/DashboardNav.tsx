"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useDashboardNavState } from "./DashboardNavContext";

/**
 * Shared top bar for every /dashboard/** page (see dashboard/layout.tsx) -
 * one "← 回到預算總覽" entry point plus a breadcrumb, instead of each page
 * building its own. Deliberately NOT sticky/fixed: the root layout's Demo
 * red banner (see app/layout.tsx) is itself `sticky top-0 z-50`, so a
 * second sticky bar here could only ever risk covering it for no benefit -
 * this bar simply sits in normal document flow, directly below the banner.
 *
 * Always navigates via a fixed router.push("/dashboard") - never
 * history.back() (a page reached from an external link/bookmark would
 * otherwise land on an arbitrary "back" target unrelated to this app).
 * When the current page has registered its own save-aware handler (see
 * useDashboardBackOverride in DashboardNavContext.tsx - used by the budget
 * version page, which must flush a pending autosave before leaving), that
 * handler runs instead of the plain navigate; this is the ONE rendered
 * button on the page, calling into whichever behavior is correct for the
 * current route, rather than that page also rendering a second competing
 * button of its own.
 */
export function DashboardNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { crumbs, onBack, busy } = useDashboardNavState();

  const isHome = pathname === "/dashboard";
  const staticCrumb = staticCrumbForPath(pathname);
  const allCrumbs = [...(staticCrumb ? [staticCrumb] : []), ...crumbs];

  function handleClick() {
    if (onBack) {
      void onBack();
    } else {
      router.push("/dashboard");
    }
  }

  return (
    <nav aria-label="Dashboard 導覽列" className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:px-6">
        {!isHome && (
          <button
            type="button"
            onClick={handleClick}
            disabled={busy}
            aria-label="回到預算總覽"
            className="shrink-0 rounded border border-slate-300 px-3 py-1.5 text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            {busy ? "儲存中…" : "← 回到預算總覽"}
          </button>
        )}
        <ol aria-label="頁面路徑" className="flex flex-wrap items-center gap-x-1 gap-y-1 text-slate-500">
          <li aria-current={isHome ? "page" : undefined} className={isHome ? "font-semibold text-slate-900" : undefined}>
            {isHome ? "預算總覽" : <Link href="/dashboard" className="hover:underline">預算總覽</Link>}
          </li>
          {allCrumbs.map((label, i) => {
            const isLast = i === allCrumbs.length - 1;
            return (
              <li key={i} className="flex items-center gap-x-1">
                <span aria-hidden="true">＞</span>
                <span aria-current={isLast ? "page" : undefined} className={isLast ? "font-semibold text-slate-900" : undefined}>
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}

/**
 * Static breadcrumb label for routes whose title never depends on
 * server-fetched data - a dynamic route like /dashboard/budgets/[id]
 * instead supplies its own trailing crumb via useDashboardBreadcrumb once
 * it has loaded the department/version it is showing.
 */
export function staticCrumbForPath(pathname: string): string | null {
  if (pathname === "/dashboard/reports/budget-summary-preview") return "費用預算彙總表（版型預覽）";
  if (pathname === "/dashboard/reports") return "報表";
  return null;
}
