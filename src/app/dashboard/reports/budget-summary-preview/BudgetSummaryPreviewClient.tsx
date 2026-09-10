"use client";

import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { formatAmountCell, formatCountCell, formatGrowthRateCell } from "@/lib/reports/summaryFormat";
import {
  UNIT_BLOCKS,
  TEMPLATE_FIGURES_DISCLAIMER,
  type UnitBlock,
} from "@/lib/reports/budgetSummaryPreviewData";
import {
  STATUS_LABEL,
  buildFinanceAgg,
  financeVersionInScope,
  DATA_SCOPE_OPTIONS,
  DEFAULT_DATA_SCOPE,
  type BudgetDataScope,
  type ExportTableKey,
  type FinanceVersionDto,
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
  type ScopeCompleteness,
  type UnmappedAccountRow,
} from "@/lib/reports/multiDepartmentSummary";
import { SGA_REPORTING_ACCOUNTS, PRODUCTION_REPORTING_ACCOUNTS, type ReportingAccountMapping } from "@/lib/reports/reportingAccountMap";
import { formatTaipeiDate } from "@/lib/format/date";
import type { DeptClass } from "@prisma/client";

// ---------------------------------------------------------------------------
// Excel/PDF export links - a plain <a download> to the export API route is
// enough since it already answers with a real `attachment`
// Content-Disposition; no client-side fetch/blob juggling needed.
//
// Excel now reads the exact same multi-department query this page uses
// (fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES) - see
// lib/excel/budgetSummaryPreviewExport.ts for the root-cause history of the
// earlier "web shows Stage 2A data, Excel shows an empty placeholder" bug).
// PDF has not been extended yet - see ExportScopeNotice below.
// ---------------------------------------------------------------------------

function exportHref(tableKey: ExportTableKey, format: "xlsx" | "pdf", scope: BudgetDataScope): string {
  const params = new URLSearchParams({ table: tableKey, format, scope });
  return `/api/reports/budget-summary-preview/export?${params.toString()}`;
}

function ExportButtons({
  tableKey,
  scope,
  label,
}: {
  tableKey: ExportTableKey;
  scope: BudgetDataScope;
  label?: string;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs">
      {label && <span className="text-slate-500">{label}：</span>}
      <a
        href={exportHref(tableKey, "xlsx", scope)}
        className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 font-medium text-emerald-700 hover:bg-emerald-100"
      >
        匯出Excel
      </a>
      <a
        href={exportHref(tableKey, "pdf", scope)}
        className="rounded border border-rose-300 bg-rose-50 px-2 py-1 font-medium text-rose-700 hover:bg-rose-100"
      >
        匯出PDF
      </a>
    </span>
  );
}

function ExportScopeNotice() {
  return (
    <p className="mb-3 rounded bg-slate-100 px-3 py-2 text-xs text-slate-500">
      Excel已支援目前畫面資料（含財務管理處與 Stage 2A 測試部門）；PDF尚待下一階段更新。
    </p>
  );
}

const UNIT_BLOCK_EXPORT_KEY: Record<UnitBlock["key"], ExportTableKey> = {
  rd: "unit-rd",
  sales: "unit-sales",
  admin: "unit-admin",
  production: "unit-production-block",
};

function currentTabExportKey(tab: TabKey): ExportTableKey {
  if (tab === "unit") return "unit-all";
  if (tab === "sga") return "sga";
  return "production";
}

const TAB_LABELS = {
  unit: "單位別費用與編制",
  sga: "管銷研科目彙總",
  production: "生產科目彙總",
} as const;
type TabKey = keyof typeof TAB_LABELS;

// ---------------------------------------------------------------------------
// Colors (per reference spreadsheet convention - see README for the source)
// ---------------------------------------------------------------------------
const COLOR = {
  sectionTitle: "#dc2626", // 區塊名稱：紅色文字
  groupHeaderBg: "#dbeafe", // 年度群組表頭：灰底(略藍)
  groupHeaderText: "#1d4ed8", // 年度群組表頭：藍色文字
  columnHeaderBg: "#cbd5e1", // 一般表頭：較深灰底
  subtotalBg: "#ffedd5", // 小計：淡橘色
  totalBg: "#fef08a", // 總計：黃色
  negativeText: "#dc2626",
  rowBg: "#ffffff",
} as const;

const ROW1_HEIGHT = 34;
const ROW2_HEIGHT = 34;

interface Cell {
  text: string;
  negative?: boolean;
  align?: "left" | "right";
}

function cell(text: string, negative = false, align: "left" | "right" = "right"): Cell {
  return { text, negative, align };
}

function textCell(text: string): Cell {
  return { text, negative: false, align: "left" };
}

/** Test-data badge appended to a department name cell's text - the on-screen
 * table renders plain text cells, so the badge is a simple bracketed suffix
 * rather than a separate styled element (see StickyReportTable). */
function deptNameLabel(name: string, isTestData: boolean): string {
  return isTestData ? `${name}【測試資料】` : name;
}

interface TableRow {
  cells: Cell[];
  background?: string;
  bold?: boolean;
}

interface HeaderGroup {
  label: string;
  span: number;
}

/**
 * Shared "frozen header + frozen leading column(s)" table shell used by
 * every table on this page (four 單位別 blocks, 管銷研科目彙總,
 * 生產科目彙總) - keeps the sticky-positioning math in exactly one place.
 * Scrolls both horizontally and vertically within its own bounded-height
 * container (per spec: 表頭垂直固定、第一欄或「序＋項目」欄固定、表格可
 * 水平及垂直捲動).
 */
function StickyReportTable({
  frozenColCount,
  colWidths,
  headerGroups,
  headerLabels,
  rows,
  maxHeightPx = 480,
}: {
  frozenColCount: number;
  colWidths: number[];
  headerGroups: HeaderGroup[];
  headerLabels: string[];
  rows: TableRow[];
  maxHeightPx?: number;
}) {
  const lefts: number[] = [];
  let acc = 0;
  for (const w of colWidths) {
    lefts.push(acc);
    acc += w;
  }

  function headerCellStyle(rowIndex: 1 | 2, colIndex: number): CSSProperties {
    const frozen = colIndex < frozenColCount;
    return {
      position: "sticky",
      top: rowIndex === 1 ? 0 : ROW1_HEIGHT,
      left: frozen ? lefts[colIndex] : undefined,
      width: colWidths[colIndex],
      minWidth: colWidths[colIndex],
      height: rowIndex === 1 ? ROW1_HEIGHT : ROW2_HEIGHT,
      zIndex: frozen ? 5 : 3,
      background: rowIndex === 1 ? COLOR.groupHeaderBg : COLOR.columnHeaderBg,
      color: rowIndex === 1 ? COLOR.groupHeaderText : undefined,
      boxShadow: frozen && colIndex === frozenColCount - 1 ? "2px 0 4px -2px rgba(15, 23, 42, 0.35)" : undefined,
    };
  }

  function bodyCellStyle(colIndex: number, background: string): CSSProperties {
    const frozen = colIndex < frozenColCount;
    return {
      position: frozen ? "sticky" : "static",
      left: frozen ? lefts[colIndex] : undefined,
      width: colWidths[colIndex],
      minWidth: colWidths[colIndex],
      zIndex: frozen ? 2 : 1,
      background,
      boxShadow: frozen && colIndex === frozenColCount - 1 ? "2px 0 4px -2px rgba(15,23,42,0.25)" : undefined,
    };
  }

  return (
    <div className="overflow-auto border border-slate-300" style={{ maxHeight: maxHeightPx }}>
      <table className="border-collapse text-xs" style={{ width: colWidths.reduce((a, b) => a + b, 0) }}>
        <thead>
          <tr>
            {headerGroups.map((g, i) => (
              <th
                key={i}
                colSpan={g.span}
                className="border border-slate-300 px-2 text-xs font-semibold"
                style={headerCellStyle(1, headerGroups.slice(0, i).reduce((a, x) => a + x.span, 0))}
              >
                {g.label}
              </th>
            ))}
          </tr>
          <tr>
            {headerLabels.map((label, i) => (
              <th key={i} className="border border-slate-300 px-2 text-xs font-medium" style={headerCellStyle(2, i)}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.cells.map((c, ci) => (
                <td
                  key={ci}
                  className={`border border-slate-200 px-2 py-1 whitespace-nowrap ${c.align === "left" ? "text-left" : "text-right"} ${
                    row.bold ? "font-semibold" : ""
                  } ${c.negative ? "text-red-600" : ""}`}
                  style={bodyCellStyle(ci, row.background ?? COLOR.rowBg)}
                  title={c.text}
                >
                  {c.text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex flex-wrap items-center justify-between gap-2 first:mt-0">
      <h3 className="text-sm font-bold" style={{ color: COLOR.sectionTitle }}>
        {children}
      </h3>
      {action}
    </div>
  );
}

export function BudgetSummaryPreviewClient({
  financeDepartment,
  financeVersion: rawFinanceVersion,
  deptEntries,
}: {
  financeDepartment: { code: string; name: string } | null;
  financeVersion: FinanceVersionDto | null;
  /** Real, code-addressable departments (Stage 2A's 8 test departments plus
   * 財務管理處) with their own fiscalYear=2027 BudgetVersion/lines, if any -
   * see fetchFinanceVersion.ts#fetchDeptSummaryEntries. Drives every tab's
   * on-screen figures; the Excel export (see ExportButtons above) now reads
   * this exact same query server-side, so the two can never disagree. PDF
   * still reads financeVersion (財務管理處 only) directly - not extended yet. */
  deptEntries: DeptSummaryEntry[];
}) {
  const [tab, setTab] = useState<TabKey>("unit");
  const [dataScope, setDataScope] = useState<BudgetDataScope>(DEFAULT_DATA_SCOPE);
  const router = useRouter();

  // Export-only: the fiscalYear=2027 version filtered by the currently-
  // selected 資料範圍, used solely for the disclaimer text and the export
  // links below (see ExportScopeNotice) - the on-screen tabs never read
  // this, only deptEntries.
  const financeVersion = useMemo(() => financeVersionInScope(rawFinanceVersion, dataScope), [rawFinanceVersion, dataScope]);
  const financeAgg = useMemo(() => buildFinanceAgg(financeVersion), [financeVersion]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <h1 className="mb-1 text-xl font-bold">費用預算彙總表（版型預覽）</h1>
      <p className="mb-4 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
        Preview 測試頁：顯示財務管理處與 Stage 2A 8 個測試部門（標示【測試資料】）的即時資料，其餘部門尚未匯入。
        {financeVersion && ` ${TEMPLATE_FIGURES_DISCLAIMER}`}
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-slate-50 px-3 py-2">
        <label className="text-sm text-slate-700">
          資料範圍：
          <select
            value={dataScope}
            onChange={(e) => setDataScope(e.target.value as BudgetDataScope)}
            className="ml-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          >
            {DATA_SCOPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <ExportButtons tableKey={currentTabExportKey(tab)} scope={dataScope} label="匯出目前表格" />
        <ExportButtons tableKey="full" scope={dataScope} label="匯出全部彙總表" />
      </div>
      <ExportScopeNotice />

      <div className="mb-4 flex gap-2 border-b border-slate-200">
        {(Object.keys(TAB_LABELS) as TabKey[]).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`rounded-t px-4 py-2 text-sm font-medium ${
              tab === key ? "border border-b-0 border-slate-300 bg-white text-brand-700" : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {TAB_LABELS[key]}
          </button>
        ))}
      </div>

      {tab === "unit" && <UnitTab deptEntries={deptEntries} dataScope={dataScope} />}
      {tab === "sga" && <SgaTab deptEntries={deptEntries} dataScope={dataScope} />}
      {tab === "production" && <ProductionTab deptEntries={deptEntries} dataScope={dataScope} />}

      {/* Bottom copy of the shared nav bar's top button - this page's
          tables can run well past one screen, so a reader who has scrolled
          all the way down should not have to scroll back up just to leave.
          Every StickyReportTable's own horizontal scroll is contained
          within its own bounded div (see StickyReportTable), so this
          page-level button - outside all of them - never moves with any
          table's horizontal scroll regardless of which tab is active. */}
      <div className="mt-8 border-t border-slate-200 pt-4">
        <button
          type="button"
          onClick={() => router.push("/dashboard")}
          aria-label="回到預算總覽"
          className="rounded border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
        >
          ← 回到預算總覽
        </button>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------
// Tab 1: 單位別費用與編制
// ---------------------------------------------------------------------------

const UNIT_COL_WIDTHS = [180, 90, 140, 90, 140, 130, 150, 130, 110, 100, 150];
const UNIT_HEADER_GROUPS: HeaderGroup[] = [
  { label: "部門", span: 1 },
  { label: "2026推估", span: 2 },
  { label: "2027目標計畫", span: 4 },
  { label: "與2026推估比較", span: 2 },
  { label: "編製情形", span: 2 },
];
const UNIT_HEADER_LABELS = [
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

function findEntry(deptEntries: DeptSummaryEntry[], code: string | undefined): DeptSummaryEntry | undefined {
  if (!code) return undefined;
  return deptEntries.find((e) => e.code === code);
}

function UnitTab({ deptEntries, dataScope }: { deptEntries: DeptSummaryEntry[]; dataScope: BudgetDataScope }) {
  return (
    <div>
      <div className="mb-4">
        <ExportButtons tableKey="unit-all" scope={dataScope} label="四大體系全部匯出" />
      </div>
      {UNIT_BLOCKS.map((block) => {
        const blockEntries: DeptSummaryEntry[] = [];
        const rows: TableRow[] = block.departments.map(({ name, code }) => {
          const entry = findEntry(deptEntries, code);
          if (entry && entry.version) {
            blockEntries.push(entry);
            const agg = buildDeptAgg(entry.version)!;
            return {
              cells: [
                textCell(deptNameLabel(name, entry.isTestData)),
                cell(formatCountCell(entry.version.priorYearHeadcount).text),
                { ...formatAmountCell(agg.priorTotal) },
                cell(formatCountCell(entry.version.budgetYearHeadcount).text),
                { ...formatAmountCell(agg.excludingNewTotal) },
                { ...formatAmountCell(agg.newHireTotal) },
                { ...formatAmountCell(agg.grandTotal) },
                { ...formatAmountCell(agg.delta) },
                { ...formatGrowthRateCell(agg.growth) },
                cell(STATUS_LABEL[entry.version.status] ?? entry.version.status, false, "left"),
                cell(formatTaipeiDate(entry.version.lastPreparedAt), false, "left"),
              ],
            };
          }
          const statusText = code ? TARGET_YEAR_NOT_PREPARED_TEXT : "未編製";
          return {
            cells: [
              textCell(entry ? deptNameLabel(name, entry.isTestData) : name),
              cell("—"),
              cell("—"),
              cell("—"),
              cell("—"),
              cell("—"),
              cell("—"),
              cell("—"),
              cell("—"),
              cell(statusText, false, "left"),
              cell("—", false, "left"),
            ],
          };
        });

        const subtotalLabel = `${block.title.split("、")[1] ?? block.title} 體系小計（暫計，尚有未編製部門）`;
        const subtotalRow: TableRow =
          blockEntries.length > 0
            ? (() => {
                const pooledLines = blockEntries.flatMap((e) => e.version!.lines);
                const agg = buildLineAgg(pooledLines);
                const priorHeadcount = blockEntries.reduce((sum, e) => sum + (e.version!.priorYearHeadcount ?? 0), 0);
                const budgetHeadcount = blockEntries.reduce((sum, e) => sum + e.version!.budgetYearHeadcount, 0);
                return {
                  background: COLOR.subtotalBg,
                  bold: true,
                  cells: [
                    textCell(subtotalLabel),
                    cell(formatCountCell(priorHeadcount).text),
                    { ...formatAmountCell(agg.prior) },
                    cell(formatCountCell(budgetHeadcount).text),
                    { ...formatAmountCell(agg.excludingNew) },
                    { ...formatAmountCell(agg.newHire) },
                    { ...formatAmountCell(agg.total) },
                    { ...formatAmountCell(agg.deltaTotal) },
                    { ...formatGrowthRateCell(agg.growthTotal) },
                    textCell(""),
                    textCell(""),
                  ],
                };
              })()
            : {
                background: COLOR.subtotalBg,
                bold: true,
                cells: [
                  textCell(subtotalLabel),
                  cell("—"),
                  cell("—"),
                  cell("—"),
                  cell("—"),
                  cell("—"),
                  cell("—"),
                  cell("—"),
                  cell("—"),
                  textCell(""),
                  textCell(""),
                ],
              };

        return (
          <div key={block.key} className="mb-6">
            <SectionTitle action={<ExportButtons tableKey={UNIT_BLOCK_EXPORT_KEY[block.key]} scope={dataScope} />}>
              {block.title}
            </SectionTitle>
            <StickyReportTable
              frozenColCount={1}
              colWidths={UNIT_COL_WIDTHS}
              headerGroups={UNIT_HEADER_GROUPS}
              headerLabels={UNIT_HEADER_LABELS}
              rows={[...rows, subtotalRow]}
            />
          </div>
        );
      })}
    </div>
  );
}

const TARGET_YEAR_NOT_PREPARED_TEXT = "2027年度尚未編製";

// ---------------------------------------------------------------------------
// Tab 2 / Tab 3 shared: 科目別彙總 - one row per reportingAccountKey, NEVER
// per department+account (see reportingAccountMap.ts / multiDepartmentSummary
// .ts#buildReportingAccountAgg for why department names must not repeat here).
// ---------------------------------------------------------------------------

const HEADCOUNT_ROW_BG = "#eef2ff"; // indigo-50, matches BudgetVersionClient's 部門人數 row

const REPORTING_COL_WIDTHS = [56, 130, 220, 140, 150, 130, 150, 130, 110];
const REPORTING_HEADER_GROUPS: HeaderGroup[] = [
  { label: "基本資料", span: 3 },
  { label: "2026推估", span: 1 },
  { label: "2027預算", span: 3 },
  { label: "與2026推估比較", span: 2 },
];
const REPORTING_HEADER_LABELS = [
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

function reportingRowCells(seq: string, key: string, name: string, m: ReturnType<typeof buildLineAgg>): Cell[] {
  return [
    cell(seq, false, "left"),
    cell(key, false, "left"),
    textCell(name),
    { ...formatAmountCell(m.prior) },
    { ...formatAmountCell(m.excludingNew) },
    { ...formatAmountCell(m.newHire) },
    { ...formatAmountCell(m.total) },
    { ...formatAmountCell(m.deltaTotal) },
    { ...formatGrowthRateCell(m.growthTotal) },
  ];
}

/** Departments overview mini-table shown at the top of the SGA/production tabs - lists each department ONCE (not per account), so it does not reintroduce the "same name repeated per row" problem this rewrite fixes in the account table below it. */
function DeptOverviewRows(entries: DeptSummaryEntry[]): TableRow[] {
  return entries.map((e) => {
    const agg = buildDeptAgg(e.version)!;
    return {
      cells: [
        textCell(deptNameLabel(e.name, e.isTestData)),
        textCell(`${STATUS_LABEL[e.version!.status] ?? e.version!.status}`),
        { ...formatAmountCell(agg.priorTotal) },
        { ...formatAmountCell(agg.excludingNewTotal) },
        { ...formatAmountCell(agg.newHireTotal) },
        { ...formatAmountCell(agg.grandTotal) },
        cell("—"),
        cell("—"),
        cell("—"),
        cell("—"),
      ],
    };
  });
}

/** 應編/已建立草稿/已輸入/已送出/尚未編製部門數 + 資料更新時間 - shown once
 * above each scope's table (see multiDepartmentSummary.ts#buildScopeCompleteness
 * for why this is a scope-level, not per-row, signal). The not-yet-prepared
 * department NAMES are only ever revealed behind an explicit expand - the
 * main table itself never lists any department. */
function CompletenessBanner({ completeness }: { completeness: ScopeCompleteness }) {
  return (
    <div className="mb-3 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span>應編部門數：{completeness.expectedDepartmentCount}</span>
        <span>已建立草稿部門數：{completeness.draftDepartmentCount}</span>
        <span>已輸入部門數：{completeness.inputDepartmentCount}</span>
        <span>已送出部門數：{completeness.submittedDepartmentCount}</span>
        <span>尚未編製部門數：{completeness.notPreparedDepartmentCount}</span>
        <span>資料更新時間：{completeness.lastUpdatedAt ? formatTaipeiDate(completeness.lastUpdatedAt) : "—"}</span>
      </div>
      {completeness.notPreparedDepartmentCount > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-slate-500">展開查看尚未編製的部門（{completeness.notPreparedDepartmentCount}）</summary>
          <p className="mt-1">{completeness.notPreparedDepartmentNames.join("、")}</p>
        </details>
      )}
      {completeness.draftDepartmentCount > 0 && completeness.draftDepartmentCount < completeness.expectedDepartmentCount && (
        <p className="mt-1 font-medium text-amber-700">部分部門未編製 - 下方金額為目前已建立草稿之部門的累計數，非全部應編部門的最終數。</p>
      )}
    </div>
  );
}

/** "待確認科目" - a real BudgetLine whose Account.code has no entry in
 * reportingAccountMap.ts (e.g. 財務管理處's own manually-created demo
 * account). Listed per-department, never merged into the main table above -
 * see buildUnmappedAccountRows's own doc comment for why. */
function UnmappedAccountsSection({ rows }: { rows: UnmappedAccountRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="mt-4">
      <SectionTitle>待確認科目（尚無報表科目對照，未併入上方彙總）</SectionTitle>
      <p className="mb-2 text-xs text-slate-500">
        以下科目目前無法明確對應到管銷研／生產的正式報表科目對照表（reportingAccountMap.ts），為避免以名稱誤合併，暫不計入上方彙總，需人工確認後再補上對照。
      </p>
      <StickyReportTable
        frozenColCount={2}
        colWidths={[110, 160, 110, 200, 130, 130]}
        headerGroups={[
          { label: "部門", span: 2 },
          { label: "科目", span: 2 },
          { label: "2026推估", span: 1 },
          { label: "2027合計", span: 1 },
        ]}
        headerLabels={["部門代碼", "部門名稱", "科目編號", "科目名稱", "2026推估", "2027合計"]}
        rows={rows.map((r) => ({
          cells: [
            cell(r.departmentCode, false, "left"),
            textCell(r.departmentName),
            cell(r.accountCode, false, "left"),
            textCell(r.accountName),
            { ...formatAmountCell(r.line.priorYearOriginalBudget) },
            { ...formatAmountCell(buildLineAgg([r.line]).total) },
          ],
        }))}
        maxHeightPx={240}
      />
    </div>
  );
}

function ReportingAccountTab({
  deptEntries,
  dataScope,
  classFilter,
  mappingTable,
  scopeDescription,
  exportKey,
  totalLabel,
}: {
  deptEntries: DeptSummaryEntry[];
  dataScope: BudgetDataScope;
  classFilter: (deptClass: DeptClass) => boolean;
  mappingTable: ReportingAccountMapping[];
  scopeDescription: string;
  exportKey: ExportTableKey;
  totalLabel: string;
}) {
  const scopeEntries = deptEntries.filter((e) => classFilter(e.class));
  const entriesWithVersion = scopeEntries.filter((e) => e.version);
  const completeness = buildScopeCompleteness(scopeEntries);
  const unmapped = buildUnmappedAccountRows(entriesWithVersion);
  const hasAnyVersion = entriesWithVersion.length > 0;

  const mappedCodes = new Set(mappingTable.flatMap((m) => Object.values(m.sourceCodes)));
  const allMappedLines = entriesWithVersion.flatMap((e) => e.version!.lines.filter((l) => mappedCodes.has(l.account.code)));
  const grandAgg = buildLineAgg(allMappedLines);

  const priorHeadcount = hasAnyVersion ? entriesWithVersion.reduce((sum, e) => sum + (e.version!.priorYearHeadcount ?? 0), 0) : null;
  const budgetHeadcount = hasAnyVersion ? entriesWithVersion.reduce((sum, e) => sum + e.version!.budgetYearHeadcount, 0) : null;

  const rows: TableRow[] = [
    {
      bold: true,
      background: HEADCOUNT_ROW_BG,
      cells: [
        cell("1", false, "left"),
        cell("", false, "left"),
        textCell("部門人數"),
        { ...formatCountCell(priorHeadcount) },
        { ...formatCountCell(budgetHeadcount) },
        cell("—"),
        cell("—"),
        cell("—"),
        cell("—"),
      ],
    },
    {
      bold: true,
      background: COLOR.totalBg,
      cells: reportingRowCells("2", "", totalLabel, grandAgg),
    },
    ...mappingTable.map((mapping) => ({
      cells: reportingRowCells(String(mapping.order + 2), mapping.reportingAccountKey, mapping.reportingAccountName, buildReportingAccountAgg(entriesWithVersion, mapping)),
    })),
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">{scopeDescription}</p>
        <ExportButtons tableKey={exportKey} scope={dataScope} />
      </div>
      <CompletenessBanner completeness={completeness} />
      {hasAnyVersion ? (
        <>
          <SectionTitle>部門總覽</SectionTitle>
          <StickyReportTable
            frozenColCount={1}
            colWidths={[180, 90, 140, 140, 130, 150, 100, 100, 100, 100]}
            headerGroups={[
              { label: "部門", span: 2 },
              { label: "2026推估", span: 1 },
              { label: "2027目標計畫", span: 3 },
              { label: "備註", span: 4 },
            ]}
            headerLabels={["部門", "狀態", "費用金額", "不含新員", "新員", "合計", "", "", "", ""]}
            rows={DeptOverviewRows(entriesWithVersion)}
            maxHeightPx={280}
          />
          <SectionTitle>科目別彙總（每個報表科目一列，不重複列出部門）</SectionTitle>
          <StickyReportTable
            frozenColCount={3}
            colWidths={REPORTING_COL_WIDTHS}
            headerGroups={REPORTING_HEADER_GROUPS}
            headerLabels={REPORTING_HEADER_LABELS}
            rows={rows}
            maxHeightPx={560}
          />
          <UnmappedAccountsSection rows={unmapped} />
        </>
      ) : (
        <p className="rounded border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">尚無部門已建立 2027 年度草稿，暫無資料可供彙總。</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: 管銷研科目彙總 (營業＋管理＋研發 - 排除生產)
// ---------------------------------------------------------------------------

function SgaTab({ deptEntries, dataScope }: { deptEntries: DeptSummaryEntry[]; dataScope: BudgetDataScope }) {
  return (
    <ReportingAccountTab
      deptEntries={deptEntries}
      dataScope={dataScope}
      classFilter={isSgaClass}
      mappingTable={SGA_REPORTING_ACCOUNTS}
      scopeDescription="管銷研範圍：營業單位（含海外單位）、管理單位、研發單位——排除所有生產單位。僅納入已有 2027 年度草稿（含 DRAFT）的部門；尚未編製的部門不計入合計。"
      exportKey="sga"
      totalLabel="管銷研費用總計"
    />
  );
}

// ---------------------------------------------------------------------------
// Tab 3: 生產科目彙總
// ---------------------------------------------------------------------------

function ProductionTab({ deptEntries, dataScope }: { deptEntries: DeptSummaryEntry[]; dataScope: BudgetDataScope }) {
  return (
    <ReportingAccountTab
      deptEntries={deptEntries}
      dataScope={dataScope}
      classFilter={isProductionClass}
      mappingTable={PRODUCTION_REPORTING_ACCOUNTS}
      scopeDescription="生產費用獨立列示，不併入管銷研；僅納入生產部、台灣廠品保處。"
      exportKey="production"
      totalLabel="生產費用總計"
    />
  );
}
