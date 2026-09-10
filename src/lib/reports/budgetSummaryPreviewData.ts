import type { DeptClass } from "@prisma/client";
import { DEMO_DEPARTMENT_CODE, DEMO_DEPARTMENT_NAME } from "@/lib/demo/constants";
import { BUDGET_OWNER_ROSTER } from "@/lib/masterdata/budgetOwnerRoster";

/**
 * Data for the multi-department budget summary preview
 * (`/dashboard/reports/budget-summary-preview`), sourced from the 45
 * Stage 2B-2 BUDGET_OWNER_ROSTER (docs/data/stage2b1-department-
 * manifest.json filtered to disposition === "BUDGET_OWNER") instead of a
 * hand-typed placeholder list - see Stage 2B-2 §七 "現有網頁彙總表與Excel
 * 匯出資料來源改為完整45個部門". Every department below is now real and
 * code-addressable: the preview looks each one up live by code (see
 * fetchFinanceVersion.ts#fetchDeptSummaryEntries) and renders its actual
 * fiscalYear=2027 BudgetVersion/lines when one exists, or "—"/"尚未編製"
 * when it does not (see lib/reports/summaryFormat.ts) - never a fabricated
 * amount for a department that has not started or confirmed its 2027
 * figures yet.
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

export interface UnitBlock {
  key: "rd" | "sales" | "admin" | "production";
  title: string;
  /** Departments shown in this block, in display order. */
  departments: readonly UnitBlockDepartment[];
}

const BLOCK_CLASS: Record<UnitBlock["key"], DeptClass> = { rd: "R", sales: "S", admin: "M", production: "P" };

function rosterDepartmentsForClass(cls: DeptClass): UnitBlockDepartment[] {
  // financeDepartmentName/Code (17203) is folded in via the roster itself
  // (it is one of the 45 BUDGET_OWNER entries) - kept aliased to
  // DEMO_DEPARTMENT_NAME/CODE below only for the one existing consumer
  // (summaryReportData.ts's single-department 財務管理處 report) that
  // still looks it up by that specific constant name.
  return BUDGET_OWNER_ROSTER.filter((r) => r.class === cls).map((r) => ({ name: r.name, code: r.code }));
}

export const UNIT_BLOCKS: readonly UnitBlock[] = (
  [
    { key: "rd", title: "一、研發事業單位" },
    { key: "sales", title: "二、營業單位（包含海外單位）" },
    { key: "admin", title: "三、管理單位" },
    { key: "production", title: "四、生產單位" },
  ] as const
).map((block) => ({ ...block, departments: rosterDepartmentsForClass(BLOCK_CLASS[block.key]) }));

/**
 * 海外歸類規則: every overseas unit is filed under 營業單位 (sales, class S)
 * above, never its own block - this is now a direct consequence of the
 * roster's own domesticOrOverseas flag (all class-S overseas entries),
 * rather than a separately maintained name list. Kept as its own export
 * for the one existing consumer that enumerates overseas names specifically
 * (see tests/budgetSummaryPreviewFormat.test.ts).
 */
export const OVERSEAS_UNIT_NAMES: readonly UnitBlockDepartment[] = BUDGET_OWNER_ROSTER.filter(
  (r) => r.class === "S" && r.domesticOrOverseas === "OVERSEAS"
).map((r) => ({ name: r.name, code: r.code }));

/** Every code-addressable department across all four blocks (all 45, since
 * every roster entry is now real and code-addressable), for the single
 * multi-department fetch behind the preview (see
 * fetchFinanceVersion.ts#fetchDeptSummaryEntries). */
export const KNOWN_DEPARTMENT_CODES: readonly string[] = UNIT_BLOCKS.flatMap((b) =>
  b.departments.filter((d): d is UnitBlockDepartment & { code: string } => Boolean(d.code)).map((d) => d.code)
);

// Sanity: DEMO_DEPARTMENT_NAME/CODE (財務管理處/17203) must resolve to the
// same entry the roster itself carries for that code - if this ever
// disagrees, the constants in lib/demo/constants.ts and the manifest have
// drifted apart and every consumer of UNIT_BLOCKS would silently show the
// wrong name for it.
if (process.env.NODE_ENV !== "production") {
  const financeEntry = BUDGET_OWNER_ROSTER.find((r) => r.code === DEMO_DEPARTMENT_CODE);
  if (!financeEntry || financeEntry.name !== DEMO_DEPARTMENT_NAME) {
    throw new Error(
      `budgetSummaryPreviewData: DEMO_DEPARTMENT_CODE/NAME (${DEMO_DEPARTMENT_CODE}/${DEMO_DEPARTMENT_NAME}) does not match BUDGET_OWNER_ROSTER's entry for that code (${financeEntry?.name ?? "not found"})`
    );
  }
}

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
