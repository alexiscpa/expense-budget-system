/**
 * Preview-only DEMO master data for the "hand-build a test budget through
 * the screen" flow (see seedDemoMasterData.ts).
 *
 * Unlike the earlier placeholder (3 self-made DEMO-ACC-* accounts under a
 * fake DEMO-DEPT department), this seeds the REAL 財務管理處 (17203)
 * department and its 62 detail expense accounts, sourced from a real
 * spreadsheet the user provided - not fabricated. The source of truth for
 * every name/category/reference amount below is:
 *
 *   File:      2026年度費用預算V2--財務.xlsx
 *   Worksheet: 財務
 *   Columns:   A（序號 = account code, per the user's instruction），
 *              B（項目 = account name）, F（2025推移 = 2025 reference amount）
 *
 * Only the 62 real line items are listed here. Six rows from that sheet are
 * deliberately EXCLUDED because they are not accounts at all:
 *   序1 平均人數（headcount, not an expense）
 *   序2 管理費用（grand subtotal）
 *   序20 人事費用／序36 銷管費用／序51 辦公費用／序68 其他費用（category subtotals）
 * Those four category totals (plus the 管理費用 grand total) must always be
 * computed live from the 62 detail lines (see lib/budget/categorySummary.ts)
 * - never re-typed from the spreadsheet's own subtotal cells, which is
 * exactly what this file avoids doing.
 *
 * `code` = the Excel A欄「序號」value as a plain string (no "FIN-" prefix,
 * no zero-padding) - see `demoAccountCode()`. This is the real account code
 * shown on screen from now on, not a provisional stand-in;
 * Account.isProvisionalCode is set to false for these rows accordingly.
 * `sourceSeq` still carries the same A欄 number (as an Int) for ordering and
 * traceability (see `sourceRef`), and is what seedDemoMasterData.ts upserts
 * on so that re-running it against a database still holding the earlier
 * FIN-xxx codes migrates those rows in place instead of duplicating them.
 *
 * The 2026 budget amount is NEVER included here - it must be entered by
 * hand on the budget screen for every line, exactly as before.
 */
import type { AccountCommonCategory } from "@prisma/client";

export const DEMO_DEPARTMENT_CODE = "17203";
export const DEMO_DEPARTMENT_NAME = "財務管理處";
// Matches the real four-category classification in
// docs/budget-system-spec-v0.4.md §1.2 (17203 財務管理處 = M / 管理).
export const DEMO_DEPARTMENT_CLASS = "M" as const;

// 2026 is the year being budgeted for in this exercise: the user fills in
// each 2026 figure by hand, using the real 2025 reference amount below for
// comparison - not a far-future placeholder year.
export const DEMO_FISCAL_YEAR = 2026;

// The real spreadsheet's reference figures ("2025推移" in column F, see
// DEMO_ACCOUNTS below) represent 2025, the fiscal year immediately before
// DEMO_FISCAL_YEAR - never a hardcoded "2025" scattered elsewhere; every
// consumer (seedDemoMasterData.ts, createBudgetVersionDraft) derives it from
// DEMO_FISCAL_YEAR so the two can never drift apart.
export const DEMO_PRIOR_REFERENCE_FISCAL_YEAR = DEMO_FISCAL_YEAR - 1;

export const DEMO_SOURCE_FILE_NAME = "2026年度費用預算V2--財務.xlsx";
export const DEMO_SOURCE_SHEET_NAME = "財務";

// 序1「平均人數」- the one row from the source spreadsheet excluded from
// DEMO_ACCOUNTS below (it is a headcount, not an expense line item - see
// that constant's comment). Used only to seed Department.priorYearHeadcount
// for 17203 財務管理處 (see seedDemoMasterData.ts), from which every new
// BudgetVersion draft derives its own priorYearHeadcount / initial
// budgetYearHeadcount (see createBudgetVersionDraft) - never fabricated,
// this is the real reference figure from 序1.
export const DEMO_DEPARTMENT_PRIOR_YEAR_HEADCOUNT = 10;

export function demoSourceRef(seq: number): string {
  return `${DEMO_SOURCE_FILE_NAME}｜${DEMO_SOURCE_SHEET_NAME}工作表｜序${seq}`;
}

/** The real account code for a DEMO account: Excel A欄「序號」as-is, no prefix/padding. */
export function demoAccountCode(seq: number): string {
  return String(seq);
}

/**
 * Identifiers of the earlier, now-retired placeholder DEMO data (3
 * self-made general-expense accounts under a fake DEMO-DEPT department).
 * seedDemoMasterData() safely deactivates (never deletes) any rows still
 * present under these codes before seeding the real data above - see the
 * "legacy cleanup" section there.
 */
export const LEGACY_DEMO_DEPARTMENT_CODE = "DEMO-DEPT";
export const LEGACY_DEMO_ACCOUNT_CODES = ["DEMO-ACC-1", "DEMO-ACC-2", "DEMO-ACC-3"] as const;

export interface DemoAccountSeed {
  seq: number;
  name: string;
  commonCategory: AccountCommonCategory;
  /** 2025推移 (2025 full-year projection), as a decimal string - the sole
   * prior-year reference figure loaded for this account. */
  priorYearReferenceAmount: string;
}

// Order matches the source worksheet exactly (序3 through 序67, subtotal
// rows skipped), grouped into the four categories per the classification
// ranges given: 薪資支出..加班費=人事費用, 交通費..出口費用－報關費=銷管費用,
// 租金支出..ICT工程費=辦公費用, 呆帳..其他費用－其他=其他費用.
export const DEMO_ACCOUNTS: readonly DemoAccountSeed[] = [
  { seq: 3, name: "薪資支出", commonCategory: "PERSONNEL", priorYearReferenceAmount: "7905511" },
  { seq: 4, name: "業績獎金", commonCategory: "PERSONNEL", priorYearReferenceAmount: "0" },
  { seq: 5, name: "端午獎金", commonCategory: "PERSONNEL", priorYearReferenceAmount: "124907" },
  { seq: 6, name: "中秋獎金", commonCategory: "PERSONNEL", priorYearReferenceAmount: "188465" },
  { seq: 7, name: "年終獎金", commonCategory: "PERSONNEL", priorYearReferenceAmount: "1158144" },
  { seq: 8, name: "職工退休金", commonCategory: "PERSONNEL", priorYearReferenceAmount: "40739" },
  {
    seq: 9,
    name: "職工退休金(新制)",
    commonCategory: "PERSONNEL",
    priorYearReferenceAmount: "343444",
  },
  { seq: 10, name: "交通津貼", commonCategory: "PERSONNEL", priorYearReferenceAmount: "0" },
  { seq: 11, name: "績效獎金", commonCategory: "PERSONNEL", priorYearReferenceAmount: "0" },
  { seq: 12, name: "研究發明獎金", commonCategory: "PERSONNEL", priorYearReferenceAmount: "0" },
  { seq: 13, name: "競賽獎金", commonCategory: "PERSONNEL", priorYearReferenceAmount: "0" },
  { seq: 14, name: "人事廣告費", commonCategory: "PERSONNEL", priorYearReferenceAmount: "0" },
  { seq: 15, name: "員工保險", commonCategory: "PERSONNEL", priorYearReferenceAmount: "1010417" },
  { seq: 16, name: "伙食費", commonCategory: "PERSONNEL", priorYearReferenceAmount: "340100" },
  { seq: 17, name: "職工福利", commonCategory: "PERSONNEL", priorYearReferenceAmount: "38813" },
  { seq: 18, name: "訓練費", commonCategory: "PERSONNEL", priorYearReferenceAmount: "35857" },
  { seq: 19, name: "加班費", commonCategory: "PERSONNEL", priorYearReferenceAmount: "0" },

  { seq: 21, name: "交通費", commonCategory: "SG_AND_A", priorYearReferenceAmount: "5951" },
  { seq: 22, name: "運費", commonCategory: "SG_AND_A", priorYearReferenceAmount: "20752" },
  { seq: 23, name: "交際費", commonCategory: "SG_AND_A", priorYearReferenceAmount: "92356" },
  { seq: 24, name: "佣金支出", commonCategory: "SG_AND_A", priorYearReferenceAmount: "0" },
  { seq: 25, name: "樣品費", commonCategory: "SG_AND_A", priorYearReferenceAmount: "0" },
  { seq: 26, name: "專案費用", commonCategory: "SG_AND_A", priorYearReferenceAmount: "2023426" },
  { seq: 27, name: "包裝費", commonCategory: "SG_AND_A", priorYearReferenceAmount: "0" },
  { seq: 28, name: "工具", commonCategory: "SG_AND_A", priorYearReferenceAmount: "0" },
  { seq: 29, name: "國內旅費", commonCategory: "SG_AND_A", priorYearReferenceAmount: "0" },
  { seq: 30, name: "國外旅費", commonCategory: "SG_AND_A", priorYearReferenceAmount: "205786" },
  {
    seq: 31,
    name: "國外旅費-大陸",
    commonCategory: "SG_AND_A",
    priorYearReferenceAmount: "31341",
  },
  { seq: 32, name: "廣告費-其他", commonCategory: "SG_AND_A", priorYearReferenceAmount: "0" },
  {
    seq: 33,
    name: "出口費用-押匯費",
    commonCategory: "SG_AND_A",
    priorYearReferenceAmount: "0",
  },
  {
    seq: 34,
    name: "出口費用-港工捐",
    commonCategory: "SG_AND_A",
    priorYearReferenceAmount: "0",
  },
  {
    seq: 35,
    name: "出口費用-報關費",
    commonCategory: "SG_AND_A",
    priorYearReferenceAmount: "0",
  },

  { seq: 37, name: "租金支出", commonCategory: "OFFICE", priorYearReferenceAmount: "0" },
  { seq: 38, name: "文具用品", commonCategory: "OFFICE", priorYearReferenceAmount: "13944" },
  { seq: 39, name: "郵電費", commonCategory: "OFFICE", priorYearReferenceAmount: "33317" },
  { seq: 40, name: "修繕費", commonCategory: "OFFICE", priorYearReferenceAmount: "0" },
  { seq: 41, name: "水電瓦斯費用", commonCategory: "OFFICE", priorYearReferenceAmount: "0" },
  { seq: 42, name: "捐贈", commonCategory: "OFFICE", priorYearReferenceAmount: "0" },
  { seq: 43, name: "稅捐", commonCategory: "OFFICE", priorYearReferenceAmount: "1866829" },
  { seq: 44, name: "勞務費", commonCategory: "OFFICE", priorYearReferenceAmount: "6107000" },
  { seq: 45, name: "雜項購置", commonCategory: "OFFICE", priorYearReferenceAmount: "0" },
  { seq: 46, name: "權利金", commonCategory: "OFFICE", priorYearReferenceAmount: "0" },
  { seq: 47, name: "雜支", commonCategory: "OFFICE", priorYearReferenceAmount: "1243334" },
  { seq: 48, name: "保險費-其他", commonCategory: "OFFICE", priorYearReferenceAmount: "55336" },
  { seq: 49, name: "工程費", commonCategory: "OFFICE", priorYearReferenceAmount: "0" },
  { seq: 50, name: "ICT工程費", commonCategory: "OFFICE", priorYearReferenceAmount: "0" },

  { seq: 52, name: "呆帳", commonCategory: "OTHER", priorYearReferenceAmount: "-709704" },
  { seq: 53, name: "折舊", commonCategory: "OTHER", priorYearReferenceAmount: "0" },
  { seq: 54, name: "各項攤提", commonCategory: "OTHER", priorYearReferenceAmount: "0" },
  { seq: 55, name: "報廢費用", commonCategory: "OTHER", priorYearReferenceAmount: "0" },
  { seq: 56, name: "分攤費用-薪資", commonCategory: "OTHER", priorYearReferenceAmount: "0" },
  { seq: 57, name: "攤銷費用", commonCategory: "OTHER", priorYearReferenceAmount: "0" },
  { seq: 58, name: "在建工程-薪資", commonCategory: "OTHER", priorYearReferenceAmount: "0" },
  { seq: 59, name: "其他費用-顧問費", commonCategory: "OTHER", priorYearReferenceAmount: "0" },
  {
    seq: 60,
    name: "其他費用-技術移轉費",
    commonCategory: "OTHER",
    priorYearReferenceAmount: "0",
  },
  { seq: 61, name: "其他費用-資料費", commonCategory: "OTHER", priorYearReferenceAmount: "0" },
  {
    seq: 62,
    name: "其他費用-其他業務費",
    commonCategory: "OTHER",
    priorYearReferenceAmount: "0",
  },
  {
    seq: 63,
    name: "其他費用-短程車資",
    commonCategory: "OTHER",
    priorYearReferenceAmount: "0",
  },
  { seq: 64, name: "工業局補助款", commonCategory: "OTHER", priorYearReferenceAmount: "0" },
  {
    seq: 65,
    name: "其他費用-保固維修",
    commonCategory: "OTHER",
    priorYearReferenceAmount: "0",
  },
  {
    seq: 66,
    name: "其他費用-保固維修費用(內部移轉)",
    commonCategory: "OTHER",
    priorYearReferenceAmount: "0",
  },
  { seq: 67, name: "其他費用-其他", commonCategory: "OTHER", priorYearReferenceAmount: "0" },
] as const;

// Sanity constant asserted by tests/demo-seed.test.ts - keeps this file and
// the requirement ("62 筆明細科目") from silently drifting apart.
export const DEMO_ACCOUNT_COUNT = 62;
