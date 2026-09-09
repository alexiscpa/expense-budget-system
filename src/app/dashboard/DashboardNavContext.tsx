"use client";

import { createContext, useContext, useEffect, useState, useCallback, useMemo } from "react";

/**
 * Lets a page nested under /dashboard/layout.tsx customize the single
 * shared "← 回到預算總覽" bar (see DashboardNav.tsx) without that page
 * rendering a second, competing button:
 *  - `crumbs`: trailing breadcrumb segments appended after "預算總覽" (e.g.
 *    a budget version page registers [department name, "2027年度預算"] to
 *    produce "預算總覽 ＞ 資訊處 ＞ 2027年度預算" - the static prefix for
 *    fixed routes like /dashboard/reports/budget-summary-preview is instead
 *    supplied by DashboardNav.tsx itself from the pathname, since that
 *    label never depends on server data).
 *  - `onBack`/`busy`: when a page already has its own save-before-navigate
 *    logic (see budgets/[id]/BudgetVersionClient.tsx and
 *    lib/client/pendingSave.ts), it registers that handler here so the ONE
 *    rendered top button calls it instead of a plain router.push - this is
 *    the reuse mechanism requirement, so a page with autosave never ends up
 *    with two independent "back" implementations that could disagree about
 *    whether a save is still pending.
 *
 * Both registrations clear themselves on unmount, so navigating to a page
 * that does not register anything always falls back to DashboardNav's
 * default (a plain, immediate navigate to /dashboard).
 */
interface DashboardNavState {
  crumbs: string[];
  onBack: (() => void | Promise<void>) | null;
  busy: boolean;
}

interface DashboardNavContextValue extends DashboardNavState {
  setCrumbs: (crumbs: string[]) => void;
  setBackOverride: (onBack: (() => void | Promise<void>) | null, busy: boolean) => void;
}

const DashboardNavContext = createContext<DashboardNavContextValue | null>(null);

export function DashboardNavProvider({ children }: { children: React.ReactNode }) {
  const [crumbs, setCrumbs] = useState<string[]>([]);
  const [onBack, setOnBack] = useState<(() => void | Promise<void>) | null>(null);
  const [busy, setBusy] = useState(false);

  const setBackOverride = useCallback((handler: (() => void | Promise<void>) | null, isBusy: boolean) => {
    // Store as a thunk - useState would otherwise try to call a function
    // value to compute the "next state" instead of storing it.
    setOnBack(() => handler);
    setBusy(isBusy);
  }, []);

  const value = useMemo(
    () => ({ crumbs, onBack, busy, setCrumbs, setBackOverride }),
    [crumbs, onBack, busy, setBackOverride]
  );

  return <DashboardNavContext.Provider value={value}>{children}</DashboardNavContext.Provider>;
}

function useDashboardNavContext(): DashboardNavContextValue {
  const ctx = useContext(DashboardNavContext);
  if (!ctx) throw new Error("useDashboardNavContext must be used within DashboardNavProvider (see dashboard/layout.tsx)");
  return ctx;
}

/** Registers this page's trailing breadcrumb segments for as long as it stays mounted. */
export function useDashboardBreadcrumb(crumbs: string[]): void {
  const { setCrumbs } = useDashboardNavContext();
  const key = crumbs.join("␟"); // stable dependency without requiring the caller to memoize the array
  useEffect(() => {
    setCrumbs(crumbs);
    return () => setCrumbs([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setCrumbs]);
}

/** Registers this page's own save-aware back handler as the ONE shared top button's click target, for as long as it stays mounted. */
export function useDashboardBackOverride(onBack: () => void | Promise<void>, busy: boolean): void {
  const { setBackOverride } = useDashboardNavContext();
  useEffect(() => {
    setBackOverride(onBack, busy);
    return () => setBackOverride(null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBack, busy, setBackOverride]);
}

/** Read-only access for DashboardNav.tsx itself. */
export function useDashboardNavState(): DashboardNavState {
  return useDashboardNavContext();
}
