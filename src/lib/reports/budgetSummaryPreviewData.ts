import { DEMO_DEPARTMENT_CODE, DEMO_DEPARTMENT_NAME } from "@/lib/demo/constants";

/**
 * Static, hand-typed data for the multi-department budget summary preview
 * (`/dashboard/reports/budget-summary-preview`).
 *
 * Most names below are still *representative* placeholders used purely to
 * show the table shape - no real Department row exists for them, and they
 * always render "—", never a fabricated amount (see
 * lib/reports/summaryFormat.ts). A name that also carries a `code` is a
 * REAL, code-addressable department (財務管理處, and Stage 2A's 8 test
 * departments) - the preview looks those up live by code (see
 * fetchFinanceVersion.ts#fetchDeptSummaryEntries) and renders their actual
 * fiscalYear=2027 BudgetVersion/lines when one exists, entirely independent
 * of whether every other name in the same block still has no code at all.
 */

/**
 * The preview's "2027目標計畫" column set must be sourced ONLY from a
 * BudgetVersion whose fiscalYear is exactly this value - never "whichever
 * version was most recently touched" (that would risk silently displaying
 * the real, currently-in-progress 2026 budget under a 2027 label). See
 * page.tsx's query and the "五、資料正確性" requirements this satisfies.
 */
export const PREVIEW_TARGET_FISCAL_YEAR = 2027;

/** The "2026推估" column is that same fiscalYear=2027 version's own prior-year reference figure - not a separately queried 2026 BudgetVersion. */
export const PREVIEW_BASE_YEAR_LABEL = "2026推估";

/**
 * Shown in place of the generic "未編製" (used for representative-only
 * departments with no data at all) specifically for a code-addressable
 * department when no fiscalYear=2027 BudgetVersion exists yet for it -
 * distinguishes "this department has real code, just no 2027 draft yet"
 * from "no data was ever entered for this representative department".
 */
export const TARGET_YEAR_NOT_PREPARED_LABEL = `${PREVIEW_TARGET_FISCAL_YEAR}年度尚未編製`;

/**
 * Disclaimer required whenever any real 財務管理處 figures are displayed
 * under the 2027目標 columns: this is layout/template scaffolding, not the
 * official 2027 budget (see spec 五-5, "版型示意數字").
 */
export const TEMPLATE_FIGURES_DISCLAIMER =
  "以下財務管理處數字為「版型示意數字」，僅供版面配置測試使用，非正式2027年度預算。";

export interface UnitBlockDepartment {
  name: string;
  /** Department.code for a real, code-addressable department - undefined
   * for a still representative-only placeholder name. */
  code?: string;
}

/**
 * 海外歸類規則: every overseas/offshore unit is filed under 營業單位 in this
 * preview, per instruction - never its own block. GWK is Stage 2A's real
 * overseas test department (code 20001); the rest remain representative
 * placeholders until real departments for them exist.
 */
export const OVERSEAS_UNIT_NAMES: readonly UnitBlockDepartment[] = [
  { name: "GWK", code: "20001" },
  { name: "GWH" },
  { name: "GWSEA" },
  { name: "GWS" },
  { name: "GWA" },
  { name: "GWI" },
  { name: "TEXIO" },
  { name: "大陸環測" },
  { name: "蘇州廠" },
  { name: "其他海外單位" },
] as const;

export interface UnitBlock {
  key: "rd" | "sales" | "admin" | "production";
  title: string;
  /** Departments shown in this block, in display order. */
  departments: readonly UnitBlockDepartment[];
}

export const UNIT_BLOCKS: readonly UnitBlock[] = [
  {
    key: "rd",
    title: "一、研發事業單位",
    departments: [
      { name: "研發一部", code: "11322" },
      { name: "研發二部" },
      { name: "電源研發部", code: "11122" },
      { name: "量測研發部" },
      { name: "研發工程部" },
    ],
  },
  {
    key: "sales",
    title: "二、營業單位（包含海外單位）",
    departments: [
      { name: "第一營業本部" },
      { name: "台北", code: "12111" },
      { name: "台中" },
      { name: "高雄" },
      { name: "行銷技術" },
      { name: "行銷支援" },
      { name: "系統整合" },
      ...OVERSEAS_UNIT_NAMES,
    ],
  },
  {
    key: "admin",
    title: "三、管理單位",
    departments: [
      { name: "董事長室" },
      { name: "稽核室" },
      { name: "經營企劃室" },
      { name: "勞安室" },
      { name: "資訊處", code: "17103" },
      { name: DEMO_DEPARTMENT_NAME, code: DEMO_DEPARTMENT_CODE },
      { name: "行政管理處", code: "17303" },
    ],
  },
  {
    key: "production",
    title: "四、生產單位",
    departments: [
      { name: "生產部", code: "16124" },
      { name: "生技部" },
      { name: "資材部" },
      { name: "採購部" },
      { name: "台灣廠品保處", code: "16204" },
    ],
  },
] as const;

/** Every code-addressable department across all four blocks, for the
 * single multi-department fetch behind the preview (see
 * fetchFinanceVersion.ts#fetchDeptSummaryEntries). */
export const KNOWN_DEPARTMENT_CODES: readonly string[] = UNIT_BLOCKS.flatMap((b) =>
  b.departments.filter((d): d is UnitBlockDepartment & { code: string } => Boolean(d.code)).map((d) => d.code)
);

/** Row labels reserved for Tab 3 (生產科目彙總) - all-dash placeholder rows shown only when no production department has any data yet. */
export const PRODUCTION_PLACEHOLDER_ROWS = [
  { label: "平均人數", kind: "detail" as const },
  { label: "生產費用", kind: "detail" as const },
  { label: "間接人員薪資", kind: "detail" as const },
  { label: "直接人員薪資", kind: "detail" as const },
  { label: "其他生產科目", kind: "detail" as const },
  { label: "人事費用小計", kind: "subtotal" as const },
  { label: "辦公費用小計", kind: "subtotal" as const },
  { label: "銷管費用小計", kind: "subtotal" as const },
  { label: "其他費用小計", kind: "subtotal" as const },
  { label: "生產費用總計", kind: "total" as const },
] as const;
