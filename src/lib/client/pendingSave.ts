/**
 * Minimal, framework-free "which save is currently in flight" tracker.
 *
 * The budget line/headcount editors on /dashboard/budgets/[id] each commit
 * on blur, independently, with no built-in way to ask "is there an edit
 * still being saved right now, and did it succeed?" from outside that one
 * field. The "← 回到預算總覽" back button needs exactly that answer: if the
 * user clicks it right after typing into a field without tabbing/clicking
 * away first, the browser's own focus change already blurs that field (and
 * triggers its save) before the button's onClick even runs - but nothing
 * upstream previously had a way to find and await that save before
 * navigating away and losing track of whether it actually finished.
 *
 * This tracker is the single, centralized place a save registers itself:
 * every save call registers its own eventual outcome (true = saved, false =
 * failed) synchronously, before that save's first internal `await` runs -
 * so by the time a synchronous DOM blur() call returns, the resulting
 * save's promise is already registered and can be awaited by anyone holding
 * this tracker. Deliberately has no React/DOM dependency so it can be unit
 * tested directly (see tests/pendingSave.test.ts) without a browser
 * environment - this project has no jsdom/testing-library setup, so a pure
 * module is what "可測試" means here, matching every other framework-free
 * logic module in this codebase (see lib/reports/multiDepartmentSummary.ts
 * for the same rationale).
 */
export interface PendingSaveTracker {
  /** Registers the promise for a save that has just started. Overwrites whatever was previously pending - only the most recent save matters. */
  register(promise: Promise<boolean>): void;
  /** The most recently registered save's eventual outcome - true when nothing has ever been registered (nothing to wait for). */
  wait(): Promise<boolean>;
}

export function createPendingSaveTracker(): PendingSaveTracker {
  let current: Promise<boolean> = Promise.resolve(true);
  return {
    register(promise: Promise<boolean>) {
      current = promise;
    },
    wait() {
      return current;
    },
  };
}
