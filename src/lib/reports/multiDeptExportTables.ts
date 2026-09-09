import { growthRate } from "@/lib/money/decimal";
import type { DeptClass } from "@prisma/client";
import { taipeiDateOnly } from "@/lib/format/date";
import { UNIT_BLOCKS, TARGET_YEAR_NOT_PREPARED_LABEL, type UnitBlock } from "@/lib/reports/budgetSummaryPreviewData";
import {
  STATUS_LABEL,
  DATA_SCOPE_OPTIONS,
  EXPORT_TABLE_TITLES,
  textCell,
  amountCell,
  countCell,
  growthCell,
  dateCell,
  type BudgetDataScope,
  type ExportTableKey,
  type RawRow,
  type RawTable,
  type ReportMeta,
} from "@/lib/reports/summaryReportData";
import {
  buildDeptAgg,
  buildLineAgg,
  buildReportingAccountAgg,
  buildUnmappedAccountRows,
  buildScopeCompleteness,
  isSgaClass,
  isProductionClass,
  type DeptSummaryEntry,
  type DeptVersionDto,
  type LineAgg,
  type ScopeCompleteness,
  type UnmappedAccountRow,
} from "@/lib/reports/multiDepartmentSummary";
import { SGA_REPORTING_ACCOUNTS, PRODUCTION_REPORTING_ACCOUNTS, type ReportingAccountMapping } from "@/lib/reports/reportingAccountMap";

/**
 * Multi-department RawTable builders for the budget summary preview's
 * Excel export - the single place where the SAME calculation functions the
 * on-screen preview uses (buildDeptAgg/buildLineAgg/buildReportingAccountAgg/
 * buildScopeCompleteness/buildUnmappedAccountRows, all from
 * multiDepartmentSummary.ts) are turned into RawTable/RawRow/RawCell
 * structures for lib/excel/budgetSummaryPreviewExport.ts. This is the fix
 * for the root cause of "web shows Stage 2A data, Excel shows an empty
 * placeholder": the export route used to call fetchFinanceDepartmentAndVersion()
 * (財務管理處 only) and feed the OLD single-department builders in
 * summaryReportData.ts; it now calls fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES)
 * - the exact same query page.tsx uses - and feeds these builders instead.
 * No number here is computed a second, independent way: every aggregate
 * comes straight from multiDepartmentSummary.ts, never re-summed locally.
 *
 * Deliberately does NOT filter individual departments/versions by the
 * selected 資料範圍 (BudgetDataScope) here: BudgetSummaryPreviewClient.tsx's
 * own UnitTab and ReportingAccountTab accept a `dataScope` prop but never
 * actually use it to decide which department/version counts - every
 * existing fiscalYear=2027 version is shown regardless of status, and
 * `dataScope` today only drives the disclaimer text and the export links'
 * `?scope=` query param. Adding real per-department scope filtering only on
 * the Excel side would make Excel and the web DISAGREE the moment a
 * non-default scope is selected (Excel would drop a department the screen
 * still shows) - the opposite of this fix's goal. `scope` is still threaded
 * through to buildMultiDeptReportMeta purely for its on-screen scope label.
 *
 * The OLD builders in summaryReportData.ts (buildUnitBlockTable/buildSgaTable/
 * buildProductionTable/buildCompanySummaryTable) are deliberately left
 * completely unchanged - the PDF export still reads them, and this round is
 * Excel-only (PDF is out of scope; see the export API route and
 * ExportScopeNotice's updated text).
 */

/** Test-data badge appended to a department name - mirrors BudgetSummaryPreviewClient.tsx's own deptNameLabel (a one-line label formatter, not a calculation - safe to keep in both places). */
function deptNameLabel(name: string, isTestData: boolean): string {
  return isTestData ? `${name}【測試資料】` : name;
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
 * Tab 1 (單位別費用與編制) for one 體系 block, driven by real deptEntries -
 * mirrors BudgetSummaryPreviewClient.tsx's UnitTab row-by-row exactly (same
 * "found a real version" branch, same "尚未編製/未編製" status text keyed
 * only off the static UNIT_BLOCKS `code` field, same pooled subtotal), just
 * emitting RawCell structures instead of JSX.
 */
export function buildMultiDeptUnitBlockTable(block: UnitBlock, deptEntries: DeptSummaryEntry[]): RawTable {
  const blockVersions: DeptVersionDto[] = [];

  const rows: RawRow[] = block.departments.map(({ name, code }) => {
    const entry = code ? deptEntries.find((e) => e.code === code) : undefined;

    if (entry && entry.version) {
      blockVersions.push(entry.version);
      const agg = buildDeptAgg(entry.version)!;
      return {
        style: "normal",
        cells: [
          textCell(deptNameLabel(name, entry.isTestData)),
          countCell(entry.version.priorYearHeadcount),
          amountCell(agg.priorTotal),
          countCell(entry.version.budgetYearHeadcount),
          amountCell(agg.excludingNewTotal),
          amountCell(agg.newHireTotal),
          amountCell(agg.grandTotal),
          amountCell(agg.delta),
          growthCell(agg.growth),
          textCell(STATUS_LABEL[entry.version.status] ?? entry.version.status),
          dateCell(taipeiDateOnly(entry.version.lastPreparedAt)),
        ],
      };
    }

    const statusText = code ? TARGET_YEAR_NOT_PREPARED_LABEL : "未編製";
    return {
      style: "normal",
      cells: [
        textCell(entry ? deptNameLabel(name, entry.isTestData) : name),
        countCell(null),
        amountCell(null),
        countCell(null),
        amountCell(null),
        amountCell(null),
        amountCell(null),
        amountCell(null),
        growthCell(null),
        textCell(statusText),
        dateCell(null),
      ],
    };
  });

  const subtotalLabel = `${block.title.split("、")[1] ?? block.title} 體系小計（暫計，尚有未編製部門）`;
  const subtotalRow: RawRow =
    blockVersions.length > 0
      ? (() => {
          const pooledLines = blockVersions.flatMap((v) => v.lines);
          const agg = buildLineAgg(pooledLines);
          const priorHeadcount = blockVersions.reduce((sum, v) => sum + (v.priorYearHeadcount ?? 0), 0);
          const budgetHeadcount = blockVersions.reduce((sum, v) => sum + v.budgetYearHeadcount, 0);
          return {
            style: "subtotal",
            cells: [
              textCell(subtotalLabel),
              countCell(priorHeadcount),
              amountCell(agg.prior),
              countCell(budgetHeadcount),
              amountCell(agg.excludingNew),
              amountCell(agg.newHire),
              amountCell(agg.total),
              amountCell(agg.deltaTotal),
              growthCell(agg.growthTotal),
              textCell(""),
              dateCell(null),
            ],
          };
        })()
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
            dateCell(null),
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

export function buildMultiDeptUnitAllTables(deptEntries: DeptSummaryEntry[]): RawTable[] {
  return UNIT_BLOCKS.map((block) => buildMultiDeptUnitBlockTable(block, deptEntries));
}

// ---------------------------------------------------------------------------
// Tab 2 / 3: 管銷研科目彙總 / 生產科目彙總 - one row per reportingAccountKey,
// never per department+account (see reportingAccountMap.ts). Two RawTables
// per scope: a small department-overview table (so a department's own
// SUBMITTED/DRAFT status and 最後編製日期 stay visible even though the main
// table below has no department column at all - spec §四-2/3 "不得列部門"
// applies to the account table, not to knowing which departments are
// covered), and the account-key table itself.
// ---------------------------------------------------------------------------

export const OVERVIEW_HEADER_GROUPS = [
  { label: "部門", span: 2 },
  { label: "2026推估", span: 1 },
  { label: "2027目標計畫", span: 3 },
];
export const OVERVIEW_HEADER_LABELS = ["部門", "狀態", "費用金額", "不含新員", "新員", "合計（含新員）"];

export const REPORTING_HEADER_GROUPS = [
  { label: "基本資料", span: 3 },
  { label: "2026推估", span: 1 },
  { label: "2027預算", span: 3 },
  { label: "與2026推估比較", span: 2 },
];
export const REPORTING_HEADER_LABELS = [
  "序",
  "報表科目編號",
  "會計科目名稱",
  "2026年推估",
  "2027年預算（不含新員）",
  "2027年新員預算",
  "2027年合計（含新員）",
  "增減金額",
  "增減率",
];

export const UNMAPPED_HEADER_GROUPS = [
  { label: "部門", span: 2 },
  { label: "科目", span: 2 },
  { label: "2026推估", span: 1 },
  { label: "2027合計", span: 1 },
];
export const UNMAPPED_HEADER_LABELS = ["部門代碼", "部門名稱", "科目編號", "科目名稱", "2026推估", "2027合計"];

function reportingRowCells(seq: string, key: string, name: string, m: LineAgg) {
  return [
    textCell(seq, "left"),
    textCell(key, "left"),
    textCell(name),
    amountCell(m.prior),
    amountCell(m.excludingNew),
    amountCell(m.newHire),
    amountCell(m.total),
    amountCell(m.deltaTotal),
    growthCell(m.growthTotal),
  ];
}

export interface MultiDeptReportingTables {
  overview: RawTable;
  accounts: RawTable;
  unmapped: RawTable | null;
  completeness: ScopeCompleteness;
  grandAgg: LineAgg;
}

/** Every mapped Account.code (across every department class the mapping table covers) - the same "which lines belong to this reporting scope at all" set used both for the grand total row and the 全公司費用合計 sheet. */
function mappedCodeSet(mappingTable: ReportingAccountMapping[]): Set<string> {
  return new Set(mappingTable.flatMap((m) => Object.values(m.sourceCodes)));
}

/** Pooled LineAgg across every mapped line in the class-filtered entries - shared by the reporting table's own total row and buildMultiDeptCompanySummaryTable, so the two can never disagree. */
export function computeReportingGrandAgg(
  deptEntries: DeptSummaryEntry[],
  classFilter: (deptClass: DeptClass) => boolean,
  mappingTable: ReportingAccountMapping[]
): LineAgg {
  const entriesWithVersion = deptEntries.filter(
    (e): e is DeptSummaryEntry & { version: DeptVersionDto } => classFilter(e.class) && Boolean(e.version)
  );
  const codes = mappedCodeSet(mappingTable);
  const allMappedLines = entriesWithVersion.flatMap((e) => e.version.lines.filter((l) => codes.has(l.account.code)));
  return buildLineAgg(allMappedLines);
}

export function buildMultiDeptReportingTables(
  deptEntries: DeptSummaryEntry[],
  classFilter: (deptClass: DeptClass) => boolean,
  mappingTable: ReportingAccountMapping[],
  totalLabel: string
): MultiDeptReportingTables {
  const scopeEntries = deptEntries.filter((e) => classFilter(e.class));
  const entriesWithVersion = scopeEntries.filter((e): e is DeptSummaryEntry & { version: DeptVersionDto } => Boolean(e.version));
  const completeness = buildScopeCompleteness(scopeEntries);
  const unmappedRows = buildUnmappedAccountRows(entriesWithVersion);
  const grandAgg = computeReportingGrandAgg(deptEntries, classFilter, mappingTable);

  const priorHeadcount = entriesWithVersion.length > 0 ? entriesWithVersion.reduce((sum, e) => sum + (e.version.priorYearHeadcount ?? 0), 0) : null;
  const budgetHeadcount = entriesWithVersion.length > 0 ? entriesWithVersion.reduce((sum, e) => sum + e.version.budgetYearHeadcount, 0) : null;

  const overview: RawTable = {
    title: "部門總覽",
    headerGroups: OVERVIEW_HEADER_GROUPS,
    headerLabels: OVERVIEW_HEADER_LABELS,
    frozenColCount: 1,
    rows: entriesWithVersion.map((e) => {
      const agg = buildDeptAgg(e.version)!;
      return {
        style: "normal",
        cells: [
          textCell(deptNameLabel(e.name, e.isTestData)),
          textCell(STATUS_LABEL[e.version.status] ?? e.version.status),
          amountCell(agg.priorTotal),
          amountCell(agg.excludingNewTotal),
          amountCell(agg.newHireTotal),
          amountCell(agg.grandTotal),
        ],
      };
    }),
  };

  const accounts: RawTable = {
    title: "科目別彙總（每個報表科目一列，不重複列出部門）",
    headerGroups: REPORTING_HEADER_GROUPS,
    headerLabels: REPORTING_HEADER_LABELS,
    frozenColCount: 3,
    rows: [
      {
        style: "normal",
        cells: [
          textCell("1", "left"),
          textCell("", "left"),
          textCell("部門人數"),
          countCell(priorHeadcount),
          countCell(budgetHeadcount),
          amountCell(null),
          amountCell(null),
          growthCell(null),
          amountCell(null),
        ],
      },
      {
        style: "total",
        cells: reportingRowCells("2", "", totalLabel, grandAgg),
      },
      ...mappingTable.map((mapping) => ({
        style: "normal" as const,
        cells: reportingRowCells(String(mapping.order + 2), mapping.reportingAccountKey, mapping.reportingAccountName, buildReportingAccountAgg(entriesWithVersion, mapping)),
      })),
    ],
  };

  const unmapped: RawTable | null =
    unmappedRows.length === 0
      ? null
      : {
          title: "待確認科目（尚無報表科目對照，未併入上方彙總）",
          headerGroups: UNMAPPED_HEADER_GROUPS,
          headerLabels: UNMAPPED_HEADER_LABELS,
          frozenColCount: 2,
          rows: unmappedRows.map((r: UnmappedAccountRow) => ({
            style: "normal" as const,
            cells: [
              textCell(r.departmentCode, "left"),
              textCell(r.departmentName),
              textCell(r.accountCode, "left"),
              textCell(r.accountName),
              amountCell(buildLineAgg([r.line]).prior),
              amountCell(buildLineAgg([r.line]).total),
            ],
          })),
        };

  return { overview, accounts, unmapped, completeness, grandAgg };
}

export function buildMultiDeptSgaTables(deptEntries: DeptSummaryEntry[]): MultiDeptReportingTables {
  return buildMultiDeptReportingTables(deptEntries, isSgaClass, SGA_REPORTING_ACCOUNTS, "管銷研費用總計");
}

export function buildMultiDeptProductionTables(deptEntries: DeptSummaryEntry[]): MultiDeptReportingTables {
  return buildMultiDeptReportingTables(deptEntries, isProductionClass, PRODUCTION_REPORTING_ACCOUNTS, "生產費用總計");
}

// ---------------------------------------------------------------------------
// 全公司費用合計 - recomputed from the same pooled SGA/Production aggregates
// used by the two reporting tables' own total rows above (computeReportingGrandAgg),
// so this sheet's total can never drift from what the SGA/生產 sheets show
// (spec §九 "避免各頁總額不一致").
// ---------------------------------------------------------------------------

export const COMPANY_SUMMARY_HEADER_GROUPS = [{ label: "全公司費用合計區", span: 7 }];
export const COMPANY_SUMMARY_HEADER_LABELS = ["項目", "2026推估", "2027不含新員", "2027新員", "2027合計", "增減金額", "增減率"];

function companyRow(label: string, agg: LineAgg, style: RawRow["style"]): RawRow {
  return {
    style,
    cells: [textCell(label), amountCell(agg.prior), amountCell(agg.excludingNew), amountCell(agg.newHire), amountCell(agg.total), amountCell(agg.deltaTotal), growthCell(agg.growthTotal)],
  };
}

export function buildMultiDeptCompanySummaryTable(deptEntries: DeptSummaryEntry[]): RawTable {
  const sgaAgg = computeReportingGrandAgg(deptEntries, isSgaClass, SGA_REPORTING_ACCOUNTS);
  const prodAgg = computeReportingGrandAgg(deptEntries, isProductionClass, PRODUCTION_REPORTING_ACCOUNTS);

  const grandPrior = sgaAgg.prior.plus(prodAgg.prior);
  const bothHaveExcludingNew = sgaAgg.excludingNew !== null && prodAgg.excludingNew !== null;
  const bothHaveNewHire = sgaAgg.newHire !== null && prodAgg.newHire !== null;
  const bothHaveTotal = sgaAgg.total !== null && prodAgg.total !== null;
  const grandAgg: LineAgg = {
    prior: grandPrior,
    excludingNew: bothHaveExcludingNew ? sgaAgg.excludingNew!.plus(prodAgg.excludingNew!) : null,
    newHire: bothHaveNewHire ? sgaAgg.newHire!.plus(prodAgg.newHire!) : null,
    total: bothHaveTotal ? sgaAgg.total!.plus(prodAgg.total!) : null,
    deltaExcl: null,
    growthExcl: null,
    deltaTotal: bothHaveTotal ? sgaAgg.total!.plus(prodAgg.total!).minus(grandPrior) : null,
    growthTotal: bothHaveTotal ? growthRate(grandPrior, sgaAgg.total!.plus(prodAgg.total!)) : null,
  };

  return {
    title: "全公司費用合計",
    headerGroups: COMPANY_SUMMARY_HEADER_GROUPS,
    headerLabels: COMPANY_SUMMARY_HEADER_LABELS,
    frozenColCount: 1,
    rows: [companyRow("管銷研費用合計", sgaAgg, "subtotal"), companyRow("生產費用合計", prodAgg, "subtotal"), companyRow("全公司費用總計", grandAgg, "total")],
  };
}

// ---------------------------------------------------------------------------
// Report metadata (title/scope/as-of/exported/provisional) - independent of
// the old single-department buildReportMeta (still used by PDF), computed
// instead from the real completeness of `deptEntries`. `scope` here is
// display-only (the "資料範圍：..." label), matching how the web page itself
// only ever uses `dataScope` for its own disclaimer text and export links -
// see this module's top-level doc comment for why no actual department is
// filtered by it.
// ---------------------------------------------------------------------------

export function buildMultiDeptReportMeta(
  tableKey: ExportTableKey,
  deptEntries: DeptSummaryEntry[],
  scope: BudgetDataScope,
  exportedAtIso: string,
  formatDate: (iso: string) => string
): ReportMeta {
  const scopeLabel = DATA_SCOPE_OPTIONS.find((o) => o.value === scope)?.label ?? scope;
  const completeness = buildScopeCompleteness(deptEntries);
  return {
    title: "2027年度費用預算彙總表",
    reportTypeLabel: EXPORT_TABLE_TITLES[tableKey],
    scopeLabel,
    asOfLabel: completeness.lastUpdatedAt ? formatDate(completeness.lastUpdatedAt) : "尚無資料",
    exportedAtLabel: formatDate(exportedAtIso),
    isProvisional: completeness.notPreparedDepartmentCount > 0 || completeness.submittedDepartmentCount < completeness.expectedDepartmentCount,
  };
}

/** Compact completeness summary line for the meta block (應編/已建立草稿/已輸入/已送出/尚未編製部門數＋資料更新時間) - text only, the underlying counts come straight from buildScopeCompleteness (see multiDepartmentSummary.ts), never recomputed. */
export function completenessSummaryLine(completeness: ScopeCompleteness, formatDate: (iso: string) => string): string {
  const updated = completeness.lastUpdatedAt ? formatDate(completeness.lastUpdatedAt) : "—";
  return `應編部門數：${completeness.expectedDepartmentCount}　已建立草稿部門數：${completeness.draftDepartmentCount}　已輸入部門數：${completeness.inputDepartmentCount}　已送出部門數：${completeness.submittedDepartmentCount}　尚未編製部門數：${completeness.notPreparedDepartmentCount}　資料更新時間：${updated}`;
}
