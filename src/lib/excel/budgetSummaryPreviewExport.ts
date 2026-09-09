import ExcelJS from "exceljs";
import { sanitizeCellText } from "@/lib/excel/sanitize";
import { formatTaipeiDate } from "@/lib/format/date";
import { UNIT_BLOCKS } from "@/lib/reports/budgetSummaryPreviewData";
import {
  type BudgetDataScope,
  type ExportTableKey,
  type RawCell,
  type RawTable,
  type ReportMeta,
  DATA_SCOPE_OPTIONS,
  EXPORT_TABLE_KEYS,
  isExportTableKey,
  provisionalNoteIfIncomplete,
} from "@/lib/reports/summaryReportData";
import type { DeptSummaryEntry } from "@/lib/reports/multiDepartmentSummary";
import {
  buildMultiDeptCompanySummaryTable,
  buildMultiDeptProductionTables,
  buildMultiDeptReportMeta,
  buildMultiDeptSgaTables,
  buildMultiDeptUnitBlockTable,
  completenessSummaryLine,
  type MultiDeptReportingTables,
} from "@/lib/reports/multiDeptExportTables";

export { EXPORT_TABLE_KEYS, isExportTableKey };
export type { ExportTableKey } from "@/lib/reports/summaryReportData";

/**
 * Real .xlsx generation (exceljs) for the budget summary preview
 * (`/dashboard/reports/budget-summary-preview`).
 *
 * Root-cause fix (see the completion report for the full investigation):
 * this file used to build every sheet from `fetchFinanceDepartmentAndVersion()`
 * (財務管理處 only) via the OLD single-department builders in
 * lib/reports/summaryReportData.ts - a SEPARATE data path from the one the
 * on-screen preview uses (`fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES)` +
 * lib/reports/multiDepartmentSummary.ts), which is why the web page showed
 * Stage 2A's 8 test departments' real figures while every Excel export
 * still showed only 財務管理處 (usually "未編製", since 財務管理處 itself has
 * no fiscalYear=2027 draft in this environment) and every other department
 * as a hand-typed placeholder row.
 *
 * Every table below is built by lib/reports/multiDeptExportTables.ts, which
 * calls the EXACT SAME aggregation functions
 * (buildDeptAgg/buildLineAgg/buildReportingAccountAgg/buildScopeCompleteness/
 * buildUnmappedAccountRows) the web page's BudgetSummaryPreviewClient.tsx
 * calls - one calculation, shared, never reimplemented here. The OLD
 * builders in summaryReportData.ts are untouched and still feed the PDF
 * export (out of scope this round - see the export API route).
 */

// Colors per the reference spreadsheet convention (matches
// BudgetSummaryPreviewClient.tsx's COLOR constant exactly).
const FILL_GROUP_HEADER = "FFDBEAFE"; // 年度群組表頭：灰底(略藍)
const FONT_GROUP_HEADER = "FF1D4ED8"; // 年度群組表頭：藍色文字
const FILL_COLUMN_HEADER = "FFCBD5E1";
const FILL_SUBTOTAL = "FFFFEDD5"; // 小計：淡橘色
const FILL_TOTAL = "FFFEF08A"; // 分類/最終總計：黃色
const FONT_SECTION_TITLE = "FFDC2626"; // 體系標題：紅字

/** Excel number format literals, exactly as specified. */
const AMOUNT_NUMFMT = "#,##0;[Red](#,##0);-";
const GROWTH_NUMFMT = "0.0%;[Red](0.0%)";
const COUNT_NUMFMT = "#,##0;[Red](#,##0);-";
const DATE_NUMFMT = "yyyy.mm.dd";

function sanitizedText(value: string): string {
  return sanitizeCellText(value);
}

/** Writes one RawTable (two-row header + body) starting at `startRow`, returns the row index just after it. */
function writeTable(
  sheet: ExcelJS.Worksheet,
  table: RawTable,
  startRow: number,
  colWidths: number[],
  sectionTitle?: string
): { headerGroupRow: number; headerLabelRow: number; endRow: number } {
  let row = startRow;

  if (sectionTitle) {
    const titleRow = sheet.getRow(row);
    titleRow.getCell(1).value = sanitizedText(sectionTitle);
    titleRow.getCell(1).font = { bold: true, color: { argb: FONT_SECTION_TITLE }, size: 12 };
    titleRow.height = 20;
    row += 1;
  }

  const headerGroupRow = row;
  const groupRow = sheet.getRow(headerGroupRow);
  let col = 1;
  for (const g of table.headerGroups) {
    groupRow.getCell(col).value = sanitizedText(g.label);
    if (g.span > 1) sheet.mergeCells(headerGroupRow, col, headerGroupRow, col + g.span - 1);
    for (let c = col; c < col + g.span; c++) {
      const cell = groupRow.getCell(c);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_GROUP_HEADER } };
      cell.font = { bold: true, color: { argb: FONT_GROUP_HEADER } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
    }
    col += g.span;
  }
  groupRow.height = 20;
  row += 1;

  const headerLabelRow = row;
  const labelRow = sheet.getRow(headerLabelRow);
  table.headerLabels.forEach((label, i) => {
    const cell = labelRow.getCell(i + 1);
    cell.value = sanitizedText(label);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL_COLUMN_HEADER } };
    cell.font = { bold: true };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
  });
  labelRow.height = 20;
  row += 1;

  for (const r of table.rows) {
    const excelRow = sheet.getRow(row);
    writeRawCells(excelRow, r.cells);
    applyRowStyle(excelRow, r.style, table.headerLabels.length);
    excelRow.height = 16;
    row += 1;
  }

  colWidths.forEach((w, i) => {
    const column = sheet.getColumn(i + 1);
    column.width = Math.max(column.width ?? 0, w);
  });

  return { headerGroupRow, headerLabelRow, endRow: row - 1 };
}

function writeRawCells(excelRow: ExcelJS.Row, cells: RawCell[]) {
  cells.forEach((c, i) => {
    const cell = excelRow.getCell(i + 1);
    cell.border = { top: { style: "hair" }, bottom: { style: "hair" }, left: { style: "hair" }, right: { style: "hair" } };
    switch (c.kind) {
      case "text":
        cell.value = sanitizedText(c.value);
        cell.alignment = { horizontal: c.align ?? "left", vertical: "middle" };
        break;
      case "amount":
        if (c.value === null) {
          cell.value = "—";
          cell.alignment = { horizontal: "right", vertical: "middle" };
        } else {
          cell.value = c.value.toNumber();
          cell.numFmt = AMOUNT_NUMFMT;
          cell.alignment = { horizontal: "right", vertical: "middle" };
        }
        break;
      case "count":
        if (c.value === null) {
          cell.value = "—";
          cell.alignment = { horizontal: "right", vertical: "middle" };
        } else {
          cell.value = c.value;
          cell.numFmt = COUNT_NUMFMT;
          cell.alignment = { horizontal: "right", vertical: "middle" };
        }
        break;
      case "growth":
        if (c.value === null) {
          cell.value = "—";
          cell.alignment = { horizontal: "right", vertical: "middle" };
        } else {
          cell.value = c.value.toNumber();
          cell.numFmt = GROWTH_NUMFMT;
          cell.alignment = { horizontal: "right", vertical: "middle" };
        }
        break;
      case "date":
        if (c.value === null) {
          cell.value = "—";
          cell.alignment = { horizontal: "right", vertical: "middle" };
        } else {
          cell.value = c.value;
          cell.numFmt = DATE_NUMFMT;
          cell.alignment = { horizontal: "right", vertical: "middle" };
        }
        break;
    }
  });
}

function applyRowStyle(excelRow: ExcelJS.Row, style: RawTable["rows"][number]["style"], colCount: number) {
  if (style === "normal") return;
  const fill = style === "subtotal" ? FILL_SUBTOTAL : FILL_TOTAL;
  for (let i = 1; i <= colCount; i++) {
    const cell = excelRow.getCell(i);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    cell.font = { ...(cell.font ?? {}), bold: true };
  }
}

const MULTI_DEPT_DATA_NOTE =
  "Preview 測試頁：顯示財務管理處與 Stage 2A 8 個測試部門（標示【測試資料】）的即時資料，其餘部門尚未匯入，一律顯示「—」（絕不顯示為 0）。";

/** Metadata block (title + report type + as-of/export time + data scope + completeness note) written above every table. */
function writeMetaBlock(sheet: ExcelJS.Worksheet, startRow: number, meta: ReportMeta, colSpan: number, extraNoteLine?: string): number {
  let row = startRow;

  const titleRow = sheet.getRow(row);
  titleRow.getCell(1).value = meta.title;
  titleRow.getCell(1).font = { bold: true, size: 16 };
  sheet.mergeCells(row, 1, row, Math.max(colSpan, 2));
  titleRow.height = 26;
  row += 1;

  const typeRow = sheet.getRow(row);
  typeRow.getCell(1).value = `報表種類：${meta.reportTypeLabel}`;
  sheet.mergeCells(row, 1, row, Math.max(colSpan, 2));
  row += 1;

  const scopeRow = sheet.getRow(row);
  scopeRow.getCell(1).value = `資料範圍：${meta.scopeLabel}　　資料截至：${meta.asOfLabel}　　匯出時間：${meta.exportedAtLabel}`;
  sheet.mergeCells(row, 1, row, Math.max(colSpan, 2));
  row += 1;

  const disclaimerRow = sheet.getRow(row);
  disclaimerRow.getCell(1).value = MULTI_DEPT_DATA_NOTE;
  disclaimerRow.getCell(1).font = { italic: true, size: 9, color: { argb: "FF92400E" } };
  sheet.mergeCells(row, 1, row, Math.max(colSpan, 2));
  row += 1;

  if (extraNoteLine) {
    const noteLine = sheet.getRow(row);
    noteLine.getCell(1).value = extraNoteLine;
    noteLine.getCell(1).font = { size: 9, color: { argb: "FF475569" } };
    sheet.mergeCells(row, 1, row, Math.max(colSpan, 2));
    row += 1;
  }

  const note = provisionalNoteIfIncomplete(meta);
  if (note) {
    const noteRow = sheet.getRow(row);
    noteRow.getCell(1).value = note;
    noteRow.getCell(1).font = { bold: true, color: { argb: FONT_SECTION_TITLE } };
    sheet.mergeCells(row, 1, row, Math.max(colSpan, 2));
    row += 1;
  }

  row += 1; // spacer
  return row;
}

function finalizeSheet(
  sheet: ExcelJS.Worksheet,
  headerGroupRow: number,
  headerLabelRow: number,
  frozenColCount: number,
  endRow: number,
  colCount: number
) {
  sheet.views = [{ state: "frozen", xSplit: frozenColCount, ySplit: headerLabelRow }];
  sheet.pageSetup = {
    ...sheet.pageSetup,
    orientation: "landscape",
    paperSize: 8 as ExcelJS.PaperSize, // ISO A3 (not in exceljs's enum, but a valid raw ECMA-376 paper code)
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printArea: `A1:${sheet.getColumn(colCount).letter}${endRow}`,
    printTitlesRow: `${headerGroupRow}:${headerLabelRow}`,
    horizontalCentered: true,
  };
  sheet.headerFooter = {
    oddFooter: "&L&D &T&C第 &P 頁，共 &N 頁&R2027年度費用預算彙總表（版型預覽）",
  };
}

const UNIT_COL_WIDTHS = [24, 10, 16, 12, 16, 14, 18, 16, 10, 12, 16];
const REPORTING_COL_WIDTHS = [6, 14, 26, 16, 18, 16, 18, 16, 12];
const OVERVIEW_COL_WIDTHS = [24, 12, 16, 16, 14, 18];
const UNMAPPED_COL_WIDTHS = [12, 16, 12, 22, 14, 14];
const COMPANY_COL_WIDTHS = [30, 16, 16, 16, 16, 16, 12];

function sheetNameFor(key: string): string {
  const raw =
    {
      "unit-rd": "單位別-研發",
      "unit-sales": "單位別-營業",
      "unit-admin": "單位別-管理",
      "unit-production-block": "單位別-生產",
      "unit-all": "單位別費用與編制",
      sga: "管銷研科目彙總",
      production: "生產科目彙總",
      company: "全公司費用合計",
    }[key] ?? key;
  // Excel worksheet names are capped at 31 characters and cannot contain \/*?[]:
  return sanitizedText(raw).replace(/[\\/*?[\]:]/g, "").slice(0, 31);
}

export interface BuildExportInput {
  /** Every code-addressable department (財務管理處 + Stage 2A's 8 test
   * departments) with its own fiscalYear=2027 BudgetVersion/lines, if any -
   * the SAME fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES) call the web
   * page uses (see lib/reports/fetchFinanceVersion.ts). This is the whole
   * fix: Excel now reads exactly what the screen reads, nothing else. */
  deptEntries: DeptSummaryEntry[];
  scope: BudgetDataScope;
  exportedAtIso: string;
}

function unitBlockKeyToBlock(key: string) {
  const map: Record<string, (typeof UNIT_BLOCKS)[number]["key"]> = {
    "unit-rd": "rd",
    "unit-sales": "sales",
    "unit-admin": "admin",
    "unit-production-block": "production",
  };
  const blockKey = map[key];
  return UNIT_BLOCKS.find((b) => b.key === blockKey) ?? null;
}

/** Writes one 部門總覽 + 科目別彙總 (+ optional 待確認科目) block into `sheet`, returns the info finalizeSheet needs. */
function writeReportingTables(
  sheet: ExcelJS.Worksheet,
  tables: MultiDeptReportingTables,
  startRow: number
): { headerGroupRow: number; headerLabelRow: number; endRow: number } {
  let row = startRow;

  const noteRow = sheet.getRow(row);
  noteRow.getCell(1).value = sanitizedText(completenessSummaryLine(tables.completeness, formatTaipeiDate));
  noteRow.getCell(1).font = { size: 9, color: { argb: "FF475569" } };
  row += 2;

  const overviewResult = writeTable(sheet, tables.overview, row, OVERVIEW_COL_WIDTHS, "部門總覽");
  row = overviewResult.endRow + 2;

  const accountsResult = writeTable(sheet, tables.accounts, row, REPORTING_COL_WIDTHS, "科目別彙總（每個報表科目一列，不重複列出部門）");
  row = accountsResult.endRow + 2;

  let endRow = accountsResult.endRow;
  if (tables.unmapped) {
    const unmappedResult = writeTable(sheet, tables.unmapped, row, UNMAPPED_COL_WIDTHS, tables.unmapped.title);
    endRow = unmappedResult.endRow;
  }

  return { headerGroupRow: accountsResult.headerGroupRow, headerLabelRow: accountsResult.headerLabelRow, endRow };
}

async function buildSingleTableWorkbook(tableKey: ExportTableKey, input: BuildExportInput): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "expense-budget-system";
  workbook.created = new Date(input.exportedAtIso);

  const meta = buildMultiDeptReportMeta(tableKey, input.deptEntries, input.scope, input.exportedAtIso, formatTaipeiDate);
  const sheet = workbook.addWorksheet(sheetNameFor(tableKey), { views: [{ showGridLines: true }] });

  if (tableKey === "unit-all") {
    let row = writeMetaBlock(sheet, 1, meta, UNIT_COL_WIDTHS.length);
    let firstHeaderGroupRow = -1;
    let lastHeaderLabelRow = -1;
    let lastEndRow = row;
    for (const block of UNIT_BLOCKS) {
      const table = buildMultiDeptUnitBlockTable(block, input.deptEntries);
      const { headerGroupRow, headerLabelRow, endRow } = writeTable(sheet, table, row, UNIT_COL_WIDTHS, block.title);
      if (firstHeaderGroupRow === -1) firstHeaderGroupRow = headerGroupRow;
      lastHeaderLabelRow = headerLabelRow;
      lastEndRow = endRow;
      row = endRow + 2;
    }
    finalizeSheet(sheet, firstHeaderGroupRow, lastHeaderLabelRow, 1, lastEndRow, UNIT_COL_WIDTHS.length);
  } else if (tableKey.startsWith("unit-")) {
    const block = unitBlockKeyToBlock(tableKey);
    if (!block) throw new Error(`unknown unit block key: ${tableKey}`);
    const table = buildMultiDeptUnitBlockTable(block, input.deptEntries);
    const row = writeMetaBlock(sheet, 1, meta, UNIT_COL_WIDTHS.length);
    const { headerGroupRow, headerLabelRow, endRow } = writeTable(sheet, table, row, UNIT_COL_WIDTHS, block.title);
    finalizeSheet(sheet, headerGroupRow, headerLabelRow, 1, endRow, UNIT_COL_WIDTHS.length);
  } else if (tableKey === "sga") {
    const tables = buildMultiDeptSgaTables(input.deptEntries);
    const row = writeMetaBlock(sheet, 1, meta, REPORTING_COL_WIDTHS.length, "管銷研範圍：營業單位（含海外單位）、管理單位、研發單位——排除所有生產單位。");
    const { headerGroupRow, headerLabelRow, endRow } = writeReportingTables(sheet, tables, row);
    finalizeSheet(sheet, headerGroupRow, headerLabelRow, 3, endRow, REPORTING_COL_WIDTHS.length);
  } else if (tableKey === "production") {
    const tables = buildMultiDeptProductionTables(input.deptEntries);
    const row = writeMetaBlock(sheet, 1, meta, REPORTING_COL_WIDTHS.length, "生產費用獨立列示，不併入管銷研；僅納入生產部、台灣廠品保處。");
    const { headerGroupRow, headerLabelRow, endRow } = writeReportingTables(sheet, tables, row);
    finalizeSheet(sheet, headerGroupRow, headerLabelRow, 3, endRow, REPORTING_COL_WIDTHS.length);
  } else if (tableKey === "company") {
    const table = buildMultiDeptCompanySummaryTable(input.deptEntries);
    const row = writeMetaBlock(sheet, 1, meta, COMPANY_COL_WIDTHS.length);
    const { headerGroupRow, headerLabelRow, endRow } = writeTable(sheet, table, row, COMPANY_COL_WIDTHS);
    finalizeSheet(sheet, headerGroupRow, headerLabelRow, 1, endRow, COMPANY_COL_WIDTHS.length);
  } else {
    throw new Error(`unsupported single-table export key: ${tableKey}`);
  }

  return workbook;
}

/** "匯出全部彙總表" - one workbook, at least the three required worksheets (單位別費用與編制／管銷研科目彙總／生產科目彙總), plus 全公司費用合計 and 報表說明 - all built from the same `input.deptEntries` snapshot so no two sheets can disagree. */
async function buildFullWorkbook(input: BuildExportInput): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "expense-budget-system";
  workbook.created = new Date(input.exportedAtIso);

  // 1. 全公司費用合計
  {
    const meta = buildMultiDeptReportMeta("company", input.deptEntries, input.scope, input.exportedAtIso, formatTaipeiDate);
    const sheet = workbook.addWorksheet(sheetNameFor("company"));
    const table = buildMultiDeptCompanySummaryTable(input.deptEntries);
    const row = writeMetaBlock(sheet, 1, meta, COMPANY_COL_WIDTHS.length);
    const { headerGroupRow, headerLabelRow, endRow } = writeTable(sheet, table, row, COMPANY_COL_WIDTHS);
    finalizeSheet(sheet, headerGroupRow, headerLabelRow, 1, endRow, COMPANY_COL_WIDTHS.length);
  }

  // 2. 單位別費用與編制 (all four blocks stacked in one sheet)
  {
    const meta = buildMultiDeptReportMeta("unit-all", input.deptEntries, input.scope, input.exportedAtIso, formatTaipeiDate);
    const sheet = workbook.addWorksheet(sheetNameFor("unit-all"));
    let row = writeMetaBlock(sheet, 1, meta, UNIT_COL_WIDTHS.length);
    let firstHeaderGroupRow = -1;
    let lastHeaderLabelRow = -1;
    let lastEndRow = row;
    for (const block of UNIT_BLOCKS) {
      const table = buildMultiDeptUnitBlockTable(block, input.deptEntries);
      const { headerGroupRow, headerLabelRow, endRow } = writeTable(sheet, table, row, UNIT_COL_WIDTHS, block.title);
      if (firstHeaderGroupRow === -1) firstHeaderGroupRow = headerGroupRow;
      lastHeaderLabelRow = headerLabelRow;
      lastEndRow = endRow;
      row = endRow + 2;
    }
    finalizeSheet(sheet, firstHeaderGroupRow, lastHeaderLabelRow, 1, lastEndRow, UNIT_COL_WIDTHS.length);
  }

  // 3. 管銷研科目彙總
  {
    const meta = buildMultiDeptReportMeta("sga", input.deptEntries, input.scope, input.exportedAtIso, formatTaipeiDate);
    const sheet = workbook.addWorksheet(sheetNameFor("sga"));
    const tables = buildMultiDeptSgaTables(input.deptEntries);
    const row = writeMetaBlock(sheet, 1, meta, REPORTING_COL_WIDTHS.length, "管銷研範圍：營業單位（含海外單位）、管理單位、研發單位——排除所有生產單位。");
    const { headerGroupRow, headerLabelRow, endRow } = writeReportingTables(sheet, tables, row);
    finalizeSheet(sheet, headerGroupRow, headerLabelRow, 3, endRow, REPORTING_COL_WIDTHS.length);
  }

  // 4. 生產科目彙總
  {
    const meta = buildMultiDeptReportMeta("production", input.deptEntries, input.scope, input.exportedAtIso, formatTaipeiDate);
    const sheet = workbook.addWorksheet(sheetNameFor("production"));
    const tables = buildMultiDeptProductionTables(input.deptEntries);
    const row = writeMetaBlock(sheet, 1, meta, REPORTING_COL_WIDTHS.length, "生產費用獨立列示，不併入管銷研；僅納入生產部、台灣廠品保處。");
    const { headerGroupRow, headerLabelRow, endRow } = writeReportingTables(sheet, tables, row);
    finalizeSheet(sheet, headerGroupRow, headerLabelRow, 3, endRow, REPORTING_COL_WIDTHS.length);
  }

  // 5. 報表說明
  {
    const sheet = workbook.addWorksheet("報表說明");
    const lines = [
      "2027年度費用預算彙總表 - 報表說明",
      "",
      "版型預覽說明：",
      `・${MULTI_DEPT_DATA_NOTE}`,
      "・「2026推估」僅來自 fiscalYear=2027 之 BudgetVersion 本身的 priorYearOriginalBudget（即 Account.priorYearReferenceAmount）。",
      "・現有 fiscalYear=2026（或其他年度）之 BudgetVersion 絕不會顯示於「2027目標」欄位。",
      "・尚未輸入 2027 年度金額的部門/科目一律顯示「—」，絕不顯示為 0；使用者已明確輸入的 0 會如實顯示為 0。",
      `・資料範圍：${dataScopeLabel(input.scope)}`,
      `・匯出時間：${formatTaipeiDate(input.exportedAtIso)}`,
      "・本檔案完全由系統唯讀查詢產生，匯出動作本身不會新增、刪除或修改任何資料庫資料。",
    ];
    lines.forEach((line, i) => {
      const cell = sheet.getCell(i + 1, 1);
      cell.value = sanitizedText(line);
      if (i === 0) cell.font = { bold: true, size: 14 };
    });
    sheet.getColumn(1).width = 100;
  }

  return workbook;
}

function dataScopeLabel(scope: BudgetDataScope): string {
  return DATA_SCOPE_OPTIONS.find((o) => o.value === scope)?.label ?? scope;
}

export async function buildBudgetSummaryPreviewExcel(tableKey: ExportTableKey, input: BuildExportInput): Promise<Buffer> {
  const workbook = tableKey === "full" ? await buildFullWorkbook(input) : await buildSingleTableWorkbook(tableKey, input);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
