/**
 * Fixed identifiers for the Preview-only DEMO test master data (see
 * lib/demo/seedDemoMasterData.ts). Deliberately distinctive "DEMO-"-prefixed
 * codes and a far-future fiscal year so this data can never be mistaken for,
 * or collide with, any real department/account/fiscal-year master data.
 */
export const DEMO_DEPARTMENT_CODE = "DEMO-DEPT";
export const DEMO_DEPARTMENT_NAME = "DEMO 測試部門（僅供 Preview 測試，非正式部門）";

// Comfortably within createDraftSchema's fiscalYear range (2000-2100) while
// being obviously not a real near-term budget year.
export const DEMO_FISCAL_YEAR = 2099;

export const DEMO_ACCOUNTS = [
  { code: "DEMO-ACC-1", name: "DEMO 測試科目一（一般費用，僅供測試）" },
  { code: "DEMO-ACC-2", name: "DEMO 測試科目二（一般費用，僅供測試）" },
  { code: "DEMO-ACC-3", name: "DEMO 測試科目三（一般費用，僅供測試）" },
] as const;
