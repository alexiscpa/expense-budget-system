import { DEMO_DEPARTMENT_NAME } from "@/lib/demo/constants";

/**
 * Static, hand-typed data for Stage 1 of the multi-department budget
 * summary preview (`/dashboard/reports/budget-summary-preview`).
 *
 * This is layout-only scaffolding: every name below is a *representative*
 * department name used purely to show the table shape, never a real
 * Department row (this stage creates none) and never a fabricated amount
 * (every non-財務管理處 department renders "—", not "0" - see
 * lib/reports/summaryFormat.ts). Only 財務管理處 (17203) is backed by real
 * BudgetVersion/BudgetLine data, read live in page.tsx.
 */

/**
 * 海外歸類規則: every overseas/offshore unit is filed under 營業單位 in this
 * preview, per instruction - never its own block.
 */
export const OVERSEAS_UNIT_NAMES = [
  "GWK",
  "GWH",
  "GWSEA",
  "GWS",
  "GWA",
  "GWI",
  "TEXIO",
  "大陸環測",
  "蘇州廠",
  "其他海外單位",
] as const;

export interface UnitBlock {
  key: "rd" | "sales" | "admin" | "production";
  title: string;
  /** Representative department names shown in this block, in display order. */
  departments: readonly string[];
}

export const UNIT_BLOCKS: readonly UnitBlock[] = [
  {
    key: "rd",
    title: "一、研發事業單位",
    departments: ["研發一部", "研發二部", "電源研發部", "量測研發部", "研發工程部"],
  },
  {
    key: "sales",
    title: "二、營業單位（包含海外單位）",
    departments: [
      "第一營業本部",
      "台北",
      "台中",
      "高雄",
      "行銷技術",
      "行銷支援",
      "系統整合",
      ...OVERSEAS_UNIT_NAMES,
    ],
  },
  {
    key: "admin",
    title: "三、管理單位",
    // 財務管理處 is deliberately in this list at its real spreadsheet
    // position - it is the one name in the whole preview backed by real
    // BudgetVersion data; every other name here is still representative-only.
    departments: ["董事長室", "稽核室", "經營企劃室", "勞安室", "資訊處", DEMO_DEPARTMENT_NAME, "行政管理處"],
  },
  {
    key: "production",
    title: "四、生產單位",
    departments: ["生產部", "生技部", "資材部", "採購部", "品保處"],
  },
] as const;

/** Row labels reserved for Tab 3 (生產科目彙總) - all-dash placeholder rows until production data exists (see spec §四). */
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
