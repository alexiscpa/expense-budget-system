import { Decimal, sumDecimals, growthRate } from "@/lib/money/decimal";
import type { AccountCommonCategory, BudgetStatus } from "@prisma/client";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/lib/budget/categorySummary";
import {
  UNIT_BLOCKS,
  PRODUCTION_PLACEHOLDER_ROWS,
  TARGET_YEAR_NOT_PREPARED_LABEL,
  type UnitBlock,
} from "@/lib/reports/budgetSummaryPreviewData";

/**
 * Framework-free budget summary preview data layer
 * (`/dashboard/reports/budget-summary-preview`). No React/DOM/exceljs/
 * pdfkit imports here - this is the single source of truth for every
 * number and row shown on screen, in the Excel export, and in the PDF
 * export, so the three can never disagree (see Stage 1B spec §六:
 * "Excel與PDF應共用同一份彙總資料服務").
 */

// ---------------------------------------------------------------------------
// DTOs (mirror the JSON-serialized Prisma shape passed down from page.tsx /
// the export API route - Decimal fields arrive as strings).
// ---------------------------------------------------------------------------

export interface FinanceLineDto {
  id: string;
  priorYearOriginalBudget: string;
  nextYearTargetExcludingNew: string;
  nextYearNewHireBudget: string;
  nextYearTotal: string;
  account: { sourceSeq: number | null; name: string; commonCategory: AccountCommonCategory };
}

export interface FinanceVersionDto {
  id: string;
  status: BudgetStatus;
  priorYearHeadcount: number;
  budgetYearHeadcount: number;
  lastPreparedAt: string;
  lines: FinanceLineDto[];
}

export const STATUS_LABEL: Record<string, string> = {
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

// ---------------------------------------------------------------------------
// 資料範圍 (data scope) - Stage 1B §五. Reserved on the page for now (only
// 財務管理處 ever has real data to filter), but the rule is real: export
// content must match whatever scope is currently selected on screen.
// ---------------------------------------------------------------------------

export type BudgetDataScope = "submitted" | "draft_included" | "approved";

export const DATA_SCOPE_OPTIONS: ReadonlyArray<{ value: BudgetDataScope; label: string }> = [
  { value: "draft_included", label: "包含草稿" },
  { value: "submitted", label: "僅已送出" },
  { value: "approved", label: "僅已核准" },
];

export const DEFAULT_DATA_SCOPE: BudgetDataScope = "draft_included";

const SUBMITTED_STATUSES: ReadonlySet<BudgetStatus> = new Set([
  "SUBMITTED",
  "UNDER_REVIEW",
  "APPROVED",
  "LOCKED",
  "ADJUSTMENT_PENDING",
  "ADJUSTED",
]);
const APPROVED_STATUSES: ReadonlySet<BudgetStatus> = new Set(["APPROVED", "LOCKED", "ADJUSTED"]);

export function isStatusInScope(status: BudgetStatus, scope: BudgetDataScope): boolean {
  if (scope === "draft_included") return true;
  if (scope === "submitted") return SUBMITTED_STATUSES.has(status);
  return APPROVED_STATUSES.has(status);
}

export function isBudgetDataScope(value: string): value is BudgetDataScope {
  return DATA_SCOPE_OPTIONS.some((o) => o.value === value);
}

/** The fiscalYear=2027 version to actually use, or null if it exists but falls outside the selected scope. */
export function financeVersionInScope(
  financeVersion: FinanceVersionDto | null,
  scope: BudgetDataScope
): FinanceVersionDto | null {
  if (!financeVersion) return null;
  return isStatusInScope(financeVersion.status, scope) ? financeVersion : null;
}

/**
 * The status text for 財務管理處 when it has no in-scope 2027 figures to
 * show - distinguishes three different reasons, per Stage 1B §五-3:
 *  - no fiscalYear=2027 BudgetVersion exists at all yet
 *  - one exists, but its status falls outside the currently selected scope
 * (the third case - real in-scope data exists - is handled by the caller,
 * which never calls this function then.)
 */
export function financeNotInScopeStatusLabel(
  rawFinanceVersion: FinanceVersionDto | null,
  scope: BudgetDataScope
): string {
  if (!rawFinanceVersion) return TARGET_YEAR_NOT_PREPARED_LABEL;
  const scopeLabel = DATA_SCOPE_OPTIONS.find((o) => o.value === scope)?.label ?? scope;
  return `已編製（${STATUS_LABEL[rawFinanceVersion.status] ?? rawFinanceVersion.status}），不在目前篩選範圍「${scopeLabel}」`;
}

// ---------------------------------------------------------------------------
// Core aggregation (pure Decimal math - identical for web/Excel/PDF).
// ---------------------------------------------------------------------------

export interface FinanceAgg {
  priorTotal: Decimal;
  excludingNewTotal: Decimal;
  newHireTotal: Decimal;
  grandTotal: Decimal;
  delta: Decimal;
  growth: Decimal | null;
}

export function buildFinanceAgg(financeVersion: FinanceVersionDto | null): FinanceAgg | null {
  if (!financeVersion) return null;
  const priorTotal = sumDecimals(financeVersion.lines.map((l) => l.priorYearOriginalBudget));
  const excludingNewTotal = sumDecimals(financeVersion.lines.map((l) => l.nextYearTargetExcludingNew));
  const newHireTotal = sumDecimals(financeVersion.lines.map((l) => l.nextYearNewHireBudget));
  const grandTotal = sumDecimals(financeVersion.lines.map((l) => l.nextYearTotal));
  return {
    priorTotal,
    excludingNewTotal,
    newHireTotal,
    grandTotal,
    delta: grandTotal.minus(priorTotal),
    growth: growthRate(priorTotal, grandTotal),
  };
}

export interface LineMetrics {
  prior: Decimal;
  excludingNew: Decimal;
  newHire: Decimal;
  total: Decimal;
  deltaExcl: Decimal;
  growthExcl: Decimal | null;
  deltaTotal: Decimal;
  growthTotal: Decimal | null;
}

export function metricsForLines(lines: FinanceLineDto[]): LineMetrics {
  const prior = sumDecimals(lines.map((l) => l.priorYearOriginalBudget));
  const excludingNew = sumDecimals(lines.map((l) => l.nextYearTargetExcludingNew));
  const newHire = sumDecimals(lines.map((l) => l.nextYearNewHireBudget));
  const total = sumDecimals(lines.map((l) => l.nextYearTotal));
  return {
    prior,
    excludingNew,
    newHire,
    total,
    deltaExcl: excludingNew.minus(prior),
    growthExcl: growthRate(prior, excludingNew),
    deltaTotal: total.minus(prior),
    growthTotal: growthRate(prior, total),
  };
}

// ---------------------------------------------------------------------------
// Raw, presentation-free row/table structures - shared by the Excel and PDF
// builders (spec §六). Each cell carries a real Decimal/number/null value,
// never a pre-formatted string, so Excel can apply real numeric cell
// formats and PDF can apply the exact same formatAmountCell()/
// formatGrowthRateCell() helpers the web page uses.
// ---------------------------------------------------------------------------

export type RawCell =
  | { kind: "text"; value: string; align?: "left" | "right" }
  | { kind: "amount"; value: Decimal | null }
  | { kind: "count"; value: number | null }
  | { kind: "growth"; value: Decimal | null };

export interface RawRow {
  cells: RawCell[];
  style: "normal" | "subtotal" | "total";
}

export interface RawTable {
  title: string;
  headerGroups: { label: string; span: number }[];
  headerLabels: string[];
  frozenColCount: number;
  rows: RawRow[];
}

function textCell(value: string, align: "left" | "right" = "left"): RawCell {
  return { kind: "text", value, align };
}
function amountCell(value: Decimal | null): RawCell {
  return { kind: "amount", value };
}
function countCell(value: number | null): RawCell {
  return { kind: "count", value };
}
function growthCell(value: Decimal | null): RawCell {
  return { kind: "growth", value };
}

export const UNIT_HEADER_GROUPS = [
  { label: "部門", span: 1 },
  { label: "2026推估", span: 2 },
  { label: "2027目標計畫", span: 4 },
  { label: "與2026推估比較", span: 2 },
  { label: "編製情形", span: 2 },
];
export const UNIT_HEADER_LABELS = [
  "部門",
  "人數",
  "費用金額",
  "編制人數",
  "預算金額",
  "新員預算",
  "合計（含新員）",
  "增減金額",
  "成長率",
  "狀態",
  "最後編製日期",
];

/**
 * Table for one 單位別 block (研發/營業/管理/生產). 財務管理處's row uses
 * real figures only when its fiscalYear=2027 version is both present and
 * within the selected data scope; every other department is a hand-typed
 * representative name and always renders "—" (never a fabricated 0).
 */
export function buildUnitBlockTable(
  block: UnitBlock,
  financeDepartmentName: string | null,
  rawFinanceVersion: FinanceVersionDto | null,
  scope: BudgetDataScope,
  lastPreparedAtLabel: (iso: string) => string
): RawTable {
  const inScope = financeVersionInScope(rawFinanceVersion, scope);
  const agg = buildFinanceAgg(inScope);

  const rows: RawRow[] = block.departments.map(({ name }) => {
    const isFinanceDept = Boolean(financeDepartmentName && name === financeDepartmentName);
    if (isFinanceDept && inScope && agg) {
      return {
        style: "normal",
        cells: [
          textCell(name),
          countCell(inScope.priorYearHeadcount),
          amountCell(agg.priorTotal),
          countCell(inScope.budgetYearHeadcount),
          amountCell(agg.excludingNewTotal),
          amountCell(agg.newHireTotal),
          amountCell(agg.grandTotal),
          amountCell(agg.delta),
          growthCell(agg.growth),
          textCell(STATUS_LABEL[inScope.status] ?? inScope.status),
          textCell(lastPreparedAtLabel(inScope.lastPreparedAt)),
        ],
      };
    }
    const statusText = isFinanceDept ? financeNotInScopeStatusLabel(rawFinanceVersion, scope) : "未編製";
    return {
      style: "normal",
      cells: [
        textCell(name),
        countCell(null),
        amountCell(null),
        countCell(null),
        amountCell(null),
        amountCell(null),
        amountCell(null),
        amountCell(null),
        growthCell(null),
        textCell(statusText),
        textCell("—"),
      ],
    };
  });

  const realInBlock = Boolean(
    financeDepartmentName && block.departments.some((d) => d.name === financeDepartmentName) && inScope && agg
  );
  const subtotalLabel = `${block.title.split("、")[1] ?? block.title} 體系小計（暫計，尚有未編製部門）`;
  const subtotalRow: RawRow = realInBlock
    ? {
        style: "subtotal",
        cells: [
          textCell(subtotalLabel),
          countCell(inScope!.priorYearHeadcount),
          amountCell(agg!.priorTotal),
          countCell(inScope!.budgetYearHeadcount),
          amountCell(agg!.excludingNewTotal),
          amountCell(agg!.newHireTotal),
          amountCell(agg!.grandTotal),
          amountCell(agg!.delta),
          growthCell(agg!.growth),
          textCell(""),
          textCell(""),
        ],
      }
    : {
        style: "subtotal",
        cells: [
          textCell(subtotalLabel),
          countCell(null),
          amountCell(null),
          countCell(null),
          amountCell(null),
          amountCell(null),
          amountCell(null),
          amountCell(null),
          growthCell(null),
          textCell(""),
          textCell(""),
        ],
      };

  return {
    title: block.title,
    headerGroups: UNIT_HEADER_GROUPS,
    headerLabels: UNIT_HEADER_LABELS,
    frozenColCount: 1,
    rows: [...rows, subtotalRow],
  };
}

export const ACCOUNT_HEADER_GROUPS = [
  { label: "基本資料", span: 2 },
  { label: "2026推估", span: 1 },
  { label: "2027目標計畫", span: 3 },
  { label: "與2026推估比較", span: 4 },
];
export const ACCOUNT_HEADER_LABELS = [
  "序",
  "項目",
  "2026推估",
  "2027目標不含新員",
  "2027目標新員",
  "2027合計（含新員）",
  "不含新員增減",
  "不含新員成長率",
  "含新員增減",
  "含新員成長率",
];

function metricsRowCells(seq: string, name: string, m: LineMetrics): RawCell[] {
  return [
    textCell(seq, "left"),
    textCell(name),
    amountCell(m.prior),
    amountCell(m.excludingNew),
    amountCell(m.newHire),
    amountCell(m.total),
    amountCell(m.deltaExcl),
    growthCell(m.growthExcl),
    amountCell(m.deltaTotal),
    growthCell(m.growthTotal),
  ];
}

/** Tab 2 (管銷研科目彙總) - 營業＋管理＋研發，排除生產。Empty rows when 財務管理處 has no in-scope 2027 data. */
export function buildSgaTable(rawFinanceVersion: FinanceVersionDto | null, scope: BudgetDataScope): RawTable {
  const financeVersion = financeVersionInScope(rawFinanceVersion, scope);
  const rows: RawRow[] = [];

  if (financeVersion) {
    rows.push({
      style: "normal",
      cells: [
        textCell("—", "left"),
        textCell("平均人數"),
        countCell(financeVersion.priorYearHeadcount),
        countCell(financeVersion.budgetYearHeadcount),
        amountCell(null),
        countCell(financeVersion.budgetYearHeadcount),
        amountCell(null),
        growthCell(null),
        amountCell(null),
        growthCell(null),
      ],
    });

    rows.push({
      style: "total",
      cells: metricsRowCells("—", "管銷研費用（目前僅財務管理處）", metricsForLines(financeVersion.lines)),
    });

    for (const category of CATEGORY_ORDER) {
      const linesInCategory = financeVersion.lines
        .filter((l) => l.account.commonCategory === category)
        .sort((a, b) => (a.account.sourceSeq ?? 0) - (b.account.sourceSeq ?? 0));
      for (const line of linesInCategory) {
        rows.push({
          style: "normal",
          cells: metricsRowCells(String(line.account.sourceSeq ?? "—"), line.account.name, metricsForLines([line])),
        });
      }
      rows.push({
        style: "subtotal",
        cells: metricsRowCells("—", `${CATEGORY_LABELS[category]}小計`, metricsForLines(linesInCategory)),
      });
    }

    rows.push({
      style: "total",
      cells: metricsRowCells("—", "管銷研費用總計", metricsForLines(financeVersion.lines)),
    });
  }

  return {
    title: "管銷研科目彙總",
    headerGroups: ACCOUNT_HEADER_GROUPS,
    headerLabels: ACCOUNT_HEADER_LABELS,
    frozenColCount: 2,
    rows,
  };
}

/** Tab 3 (生產科目彙總) - no production data exists yet; every figure is "—" (never fabricated). */
export function buildProductionTable(): RawTable {
  const rows: RawRow[] = PRODUCTION_PLACEHOLDER_ROWS.map((r) => ({
    style: r.kind === "total" ? "total" : r.kind === "subtotal" ? "subtotal" : "normal",
    cells: [
      textCell("—", "left"),
      textCell(r.label),
      amountCell(null),
      amountCell(null),
      amountCell(null),
      amountCell(null),
      amountCell(null),
      growthCell(null),
      amountCell(null),
      growthCell(null),
    ],
  }));

  return {
    title: "生產科目彙總",
    headerGroups: ACCOUNT_HEADER_GROUPS,
    headerLabels: ACCOUNT_HEADER_LABELS,
    frozenColCount: 2,
    rows,
  };
}

export const COMPANY_SUMMARY_HEADER_GROUPS = [{ label: "全公司費用合計區", span: 7 }];
export const COMPANY_SUMMARY_HEADER_LABELS = ["項目", "2026推估", "2027不含新員", "2027新員", "2027合計", "增減金額", "增減率"];

/** 全公司費用合計 banner shown above 管銷研/生產 - shared by both tabs and by the dedicated 全公司費用合計 export. */
export function buildCompanySummaryTable(rawFinanceVersion: FinanceVersionDto | null, scope: BudgetDataScope): RawTable {
  const financeVersion = financeVersionInScope(rawFinanceVersion, scope);
  const agg = buildFinanceAgg(financeVersion);

  const sgaRow: RawRow = agg
    ? {
        style: "subtotal",
        cells: [
          textCell("管銷研費用合計（暫計，僅財務管理處）"),
          amountCell(agg.priorTotal),
          amountCell(agg.excludingNewTotal),
          amountCell(agg.newHireTotal),
          amountCell(agg.grandTotal),
          amountCell(agg.delta),
          growthCell(agg.growth),
        ],
      }
    : {
        style: "subtotal",
        cells: [
          textCell("管銷研費用合計（暫計）"),
          amountCell(null),
          amountCell(null),
          amountCell(null),
          amountCell(null),
          amountCell(null),
          growthCell(null),
        ],
      };

  const productionRow: RawRow = {
    style: "normal",
    cells: [textCell("生產費用合計"), amountCell(null), amountCell(null), amountCell(null), amountCell(null), amountCell(null), growthCell(null)],
  };

  const grandRow: RawRow = {
    style: "total",
    cells: [textCell("全公司費用總計"), amountCell(null), amountCell(null), amountCell(null), amountCell(null), amountCell(null), growthCell(null)],
  };

  return {
    title: "全公司費用合計",
    headerGroups: COMPANY_SUMMARY_HEADER_GROUPS,
    headerLabels: COMPANY_SUMMARY_HEADER_LABELS,
    frozenColCount: 1,
    rows: [sgaRow, productionRow, grandRow],
  };
}

export function buildAllUnitBlockTables(
  financeDepartmentName: string | null,
  rawFinanceVersion: FinanceVersionDto | null,
  scope: BudgetDataScope,
  lastPreparedAtLabel: (iso: string) => string
): RawTable[] {
  return UNIT_BLOCKS.map((block) => buildUnitBlockTable(block, financeDepartmentName, rawFinanceVersion, scope, lastPreparedAtLabel));
}

// ---------------------------------------------------------------------------
// Report metadata shared by the Excel and PDF builders (Stage 1B §二/§三):
// title, report-type label, as-of date, export timestamp, data-scope label,
// and the "暫計報表" provisional-data banner.
// ---------------------------------------------------------------------------

export const REPORT_TITLE = "2027年度費用預算彙總表";

export type ExportTableKey =
  | "unit-rd"
  | "unit-sales"
  | "unit-admin"
  | "unit-production-block"
  | "unit-all"
  | "sga"
  | "production"
  | "company"
  | "full";

export const EXPORT_TABLE_KEYS: readonly ExportTableKey[] = [
  "unit-rd",
  "unit-sales",
  "unit-admin",
  "unit-production-block",
  "unit-all",
  "sga",
  "production",
  "company",
  "full",
];

export function isExportTableKey(value: string): value is ExportTableKey {
  return (EXPORT_TABLE_KEYS as readonly string[]).includes(value);
}

export const EXPORT_TABLE_TITLES: Record<ExportTableKey, string> = {
  "unit-rd": "單位別費用與編制－一、研發事業單位",
  "unit-sales": "單位別費用與編制－二、營業單位（包含海外單位）",
  "unit-admin": "單位別費用與編制－三、管理單位",
  "unit-production-block": "單位別費用與編制－四、生產單位",
  "unit-all": "單位別費用與編制（四大體系全部）",
  sga: "管銷研科目彙總",
  production: "生產科目彙總",
  company: "全公司費用合計",
  full: "全部彙總表",
};

/** Short, filesystem-safe labels used to build export filenames (Stage 1B §四). */
export const EXPORT_FILENAME_LABELS: Record<ExportTableKey, string> = {
  "unit-rd": "單位別費用與編制-研發事業單位",
  "unit-sales": "單位別費用與編制-營業單位",
  "unit-admin": "單位別費用與編制-管理單位",
  "unit-production-block": "單位別費用與編制-生產單位",
  "unit-all": "單位別費用與編制",
  sga: "管銷研科目彙總",
  production: "生產科目彙總",
  company: "全公司費用合計",
  full: "全部彙總表",
};

export interface ReportMeta {
  title: string;
  reportTypeLabel: string;
  scopeLabel: string;
  asOfLabel: string;
  exportedAtLabel: string;
  /** True whenever any department other than 財務管理處 (always representative-only in Stage 1) or 財務管理處 itself lacks in-scope 2027 data - i.e. essentially always true this stage. */
  isProvisional: boolean;
}

const PROVISIONAL_NOTE = "暫計報表：尚有未編製或未送出部門。";

export function provisionalNoteIfIncomplete(meta: ReportMeta): string | null {
  return meta.isProvisional ? PROVISIONAL_NOTE : null;
}

export function buildReportMeta(
  tableKey: ExportTableKey,
  rawFinanceVersion: FinanceVersionDto | null,
  scope: BudgetDataScope,
  exportedAtIso: string,
  formatDate: (iso: string) => string
): ReportMeta {
  const inScope = financeVersionInScope(rawFinanceVersion, scope);
  const scopeLabel = DATA_SCOPE_OPTIONS.find((o) => o.value === scope)?.label ?? scope;
  return {
    title: REPORT_TITLE,
    reportTypeLabel: EXPORT_TABLE_TITLES[tableKey],
    scopeLabel,
    asOfLabel: inScope ? formatDate(inScope.lastPreparedAt) : "尚無資料",
    exportedAtLabel: formatDate(exportedAtIso),
    // Stage 1: only 財務管理處 can ever have real data, and every other
    // representative department is always "未編製" - so every report this
    // stage produces is provisional by definition.
    isProvisional: true,
  };
}
