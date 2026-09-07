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
 *   Columns:   B（項目 = account name）, F（2025推移 = 2025 reference amount）
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
 * `code` is a temporary, stable, unique test identifier only
 * (FIN-<zero-padded 序>) - the spreadsheet has no official chart-of-accounts
 * code, only a sequence number, which this preserves 1:1 for traceability
 * (see `seq`/sourceRef). The UI must always label these as "暫用測試代碼，
 * 待正式科目代碼確認" and must never present them as confirmed official
 * account codes (Account.isProvisionalCode enforces this at the data level).
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

export const DEMO_SOURCE_FILE_NAME = "2026年度費用預算V2--財務.xlsx";
export const DEMO_SOURCE_SHEET_NAME = "財務";

export function demoSourceRef(seq: number): string {
  return `${DEMO_SOURCE_FILE_NAME}｜${DEMO_SOURCE_SHEET_NAME}工作表｜序${seq}`;
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
  code: string;
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
  { seq: 3, code: "FIN-003", name: "薪資支出", commonCategory: "PERSONNEL", priorYearReferenceAmount: "7905511" },
  { seq: 4, code: "FIN-004", name: "業績獎金", commonCategory: "PERSONNEL", priorYearReferenceAmount: "0" },
  { seq: 5, code: "FIN-005", name: "端午獎金", commonCategory: "PERSONNEL", priorYearReferenceAmount: "124907" },
  { seq: 6, code: "FIN-006", name: "中秋獎金", commonCategory: "PERSONNEL", priorYearReferenceAmount: "188465" },
  { seq: 7, code: "FIN-007", name: "年終獎金", commonCategory: "PERSONNEL", priorYearReferenceAmount: "1158144" },
  { seq: 8, code: "FIN-008", name: "職工退休金", commonCategory: "PERSONNEL", priorYearReferenceAmount: "40739" },
  {
    seq: 9,
    code: "FIN-009",
    name: "職工退休金(新制)",
    commonCategory: "PERSONNEL",
    priorYearReferenceAmount: "343444",
  },
  { seq: 10, code: "FIN-010", name: "交通津貼", commonCategory: "PERSONNEL", priorYearReferenceAmount: "0" },
  { seq: 11, code: "FIN-011", name: "績效獎金", commonCategory: "PERSONNEL", priorYearReferenceAmount: "0" },
  { seq: 12, code: "FIN-012", name: "研究發明獎金", commonCategory: "PERSONNEL", priorYearReferenceAmount: "0" },
  { seq: 13, code: "FIN-013", name: "競賽獎金", commonCategory: "PERSONNEL", priorYearReferenceAmount: "0" },
  { seq: 14, code: "FIN-014", name: "人事廣告費", commonCategory: "PERSONNEL", priorYearReferenceAmount: "0" },
  { seq: 15, code: "FIN-015", name: "員工保險", commonCategory: "PERSONNEL", priorYearReferenceAmount: "1010417" },
  { seq: 16, code: "FIN-016", name: "伙食費", commonCategory: "PERSONNEL", priorYearReferenceAmount: "340100" },
  { seq: 17, code: "FIN-017", name: "職工福利", commonCategory: "PERSONNEL", priorYearReferenceAmount: "38813" },
  { seq: 18, code: "FIN-018", name: "訓練費", commonCategory: "PERSONNEL", priorYearReferenceAmount: "35857" },
  { seq: 19, code: "FIN-019", name: "加班費", commonCategory: "PERSONNEL", priorYearReferenceAmount: "0" },

  { seq: 21, code: "FIN-021", name: "交通費", commonCategory: "SG_AND_A", priorYearReferenceAmount: "5951" },
  { seq: 22, code: "FIN-022", name: "運費", commonCategory: "SG_AND_A", priorYearReferenceAmount: "20752" },
  { seq: 23, code: "FIN-023", name: "交際費", commonCategory: "SG_AND_A", priorYearReferenceAmount: "92356" },
  { seq: 24, code: "FIN-024", name: "佣金支出", commonCategory: "SG_AND_A", priorYearReferenceAmount: "0" },
  { seq: 25, code: "FIN-025", name: "樣品費", commonCategory: "SG_AND_A", priorYearReferenceAmount: "0" },
  { seq: 26, code: "FIN-026", name: "專案費用", commonCategory: "SG_AND_A", priorYearReferenceAmount: "2023426" },
  { seq: 27, code: "FIN-027", name: "包裝費", commonCategory: "SG_AND_A", priorYearReferenceAmount: "0" },
  { seq: 28, code: "FIN-028", name: "工具", commonCategory: "SG_AND_A", priorYearReferenceAmount: "0" },
  { seq: 29, code: "FIN-029", name: "國內旅費", commonCategory: "SG_AND_A", priorYearReferenceAmount: "0" },
  { seq: 30, code: "FIN-030", name: "國外旅費", commonCategory: "SG_AND_A", priorYearReferenceAmount: "205786" },
  {
    seq: 31,
    code: "FIN-031",
    name: "國外旅費-大陸",
    commonCategory: "SG_AND_A",
    priorYearReferenceAmount: "31341",
  },
  { seq: 32, code: "FIN-032", name: "廣告費-其他", commonCategory: "SG_AND_A", priorYearReferenceAmount: "0" },
  {
    seq: 33,
    code: "FIN-033",
    name: "出口費用-押匯費",
    commonCategory: "SG_AND_A",
    priorYearReferenceAmount: "0",
  },
  {
    seq: 34,
    code: "FIN-034",
    name: "出口費用-港工捐",
    commonCategory: "SG_AND_A",
    priorYearReferenceAmount: "0",
  },
  {
    seq: 35,
    code: "FIN-035",
    name: "出口費用-報關費",
    commonCategory: "SG_AND_A",
    priorYearReferenceAmount: "0",
  },

  { seq: 37, code: "FIN-037", name: "租金支出", commonCategory: "OFFICE", priorYearReferenceAmount: "0" },
  { seq: 38, code: "FIN-038", name: "文具用品", commonCategory: "OFFICE", priorYearReferenceAmount: "13944" },
  { seq: 39, code: "FIN-039", name: "郵電費", commonCategory: "OFFICE", priorYearReferenceAmount: "33317" },
  { seq: 40, code: "FIN-040", name: "修繕費", commonCategory: "OFFICE", priorYearReferenceAmount: "0" },
  { seq: 41, code: "FIN-041", name: "水電瓦斯費用", commonCategory: "OFFICE", priorYearReferenceAmount: "0" },
  { seq: 42, code: "FIN-042", name: "捐贈", commonCategory: "OFFICE", priorYearReferenceAmount: "0" },
  { seq: 43, code: "FIN-043", name: "稅捐", commonCategory: "OFFICE", priorYearReferenceAmount: "1866829" },
  { seq: 44, code: "FIN-044", name: "勞務費", commonCategory: "OFFICE", priorYearReferenceAmount: "6107000" },
  { seq: 45, code: "FIN-045", name: "雜項購置", commonCategory: "OFFICE", priorYearReferenceAmount: "0" },
  { seq: 46, code: "FIN-046", name: "權利金", commonCategory: "OFFICE", priorYearReferenceAmount: "0" },
  { seq: 47, code: "FIN-047", name: "雜支", commonCategory: "OFFICE", priorYearReferenceAmount: "1243334" },
  { seq: 48, code: "FIN-048", name: "保險費-其他", commonCategory: "OFFICE", priorYearReferenceAmount: "55336" },
  { seq: 49, code: "FIN-049", name: "工程費", commonCategory: "OFFICE", priorYearReferenceAmount: "0" },
  { seq: 50, code: "FIN-050", name: "ICT工程費", commonCategory: "OFFICE", priorYearReferenceAmount: "0" },

  { seq: 52, code: "FIN-052", name: "呆帳", commonCategory: "OTHER", priorYearReferenceAmount: "-709704" },
  { seq: 53, code: "FIN-053", name: "折舊", commonCategory: "OTHER", priorYearReferenceAmount: "0" },
  { seq: 54, code: "FIN-054", name: "各項攤提", commonCategory: "OTHER", priorYearReferenceAmount: "0" },
  { seq: 55, code: "FIN-055", name: "報廢費用", commonCategory: "OTHER", priorYearReferenceAmount: "0" },
  { seq: 56, code: "FIN-056", name: "分攤費用-薪資", commonCategory: "OTHER", priorYearReferenceAmount: "0" },
  { seq: 57, code: "FIN-057", name: "攤銷費用", commonCategory: "OTHER", priorYearReferenceAmount: "0" },
  { seq: 58, code: "FIN-058", name: "在建工程-薪資", commonCategory: "OTHER", priorYearReferenceAmount: "0" },
  { seq: 59, code: "FIN-059", name: "其他費用-顧問費", commonCategory: "OTHER", priorYearReferenceAmount: "0" },
  {
    seq: 60,
    code: "FIN-060",
    name: "其他費用-技術移轉費",
    commonCategory: "OTHER",
    priorYearReferenceAmount: "0",
  },
  { seq: 61, code: "FIN-061", name: "其他費用-資料費", commonCategory: "OTHER", priorYearReferenceAmount: "0" },
  {
    seq: 62,
    code: "FIN-062",
    name: "其他費用-其他業務費",
    commonCategory: "OTHER",
    priorYearReferenceAmount: "0",
  },
  {
    seq: 63,
    code: "FIN-063",
    name: "其他費用-短程車資",
    commonCategory: "OTHER",
    priorYearReferenceAmount: "0",
  },
  { seq: 64, code: "FIN-064", name: "工業局補助款", commonCategory: "OTHER", priorYearReferenceAmount: "0" },
  {
    seq: 65,
    code: "FIN-065",
    name: "其他費用-保固維修",
    commonCategory: "OTHER",
    priorYearReferenceAmount: "0",
  },
  {
    seq: 66,
    code: "FIN-066",
    name: "其他費用-保固維修費用(內部移轉)",
    commonCategory: "OTHER",
    priorYearReferenceAmount: "0",
  },
  { seq: 67, code: "FIN-067", name: "其他費用-其他", commonCategory: "OTHER", priorYearReferenceAmount: "0" },
] as const;

// Sanity constant asserted by tests/demo-seed.test.ts - keeps this file and
// the requirement ("62 筆明細科目") from silently drifting apart.
export const DEMO_ACCOUNT_COUNT = 62;
