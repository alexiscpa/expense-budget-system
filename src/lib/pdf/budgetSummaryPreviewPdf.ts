import PDFDocument from "pdfkit";
import { getCjkFontBuffer } from "./cjkFont";
import { formatAmountCell, formatCountCell, formatGrowthRateCell } from "@/lib/reports/summaryFormat";
import { UNIT_BLOCKS, TEMPLATE_FIGURES_DISCLAIMER } from "@/lib/reports/budgetSummaryPreviewData";
import {
  type BudgetDataScope,
  type FinanceVersionDto,
  type RawCell,
  type RawRow,
  type RawTable,
  type ReportMeta,
  buildCompanySummaryTable,
  buildProductionTable,
  buildReportMeta,
  buildSgaTable,
  buildUnitBlockTable,
  provisionalNoteIfIncomplete,
} from "@/lib/reports/summaryReportData";
import { formatTaipeiDate } from "@/lib/format/date";
import type { ExportTableKey } from "@/lib/excel/budgetSummaryPreviewExport";

/**
 * Real, server-generated PDF export for the budget summary preview
 * (`/dashboard/reports/budget-summary-preview`) - Stage 1B §三.
 *
 * Deliberately NOT built by launching a headless browser and printing the
 * live webpage (spec: "PDF需由伺服器產生，不使用瀏覽器直接列印整個網頁"):
 * this uses pdfkit, a pure-JS PDF writer with no browser/native-binary
 * dependency at all, so it behaves identically in this sandbox and in a
 * Vercel serverless function (a headless-Chromium approach would risk
 * exceeding function size/time limits or simply not having a browser
 * binary available at all in that environment). Traditional Chinese
 * glyphs come from an embedded font subset (see ./cjkFont.ts) rather than
 * relying on whatever fonts happen to be installed on the host - the
 * standard fix for "方框/亂碼" (tofu boxes / garbled text) in a serverless
 * PDF pipeline.
 *
 * Every number comes from lib/reports/summaryReportData.ts, the same
 * module the Excel export and the web page itself read from.
 */

const PAGE_MARGIN = { top: 58, bottom: 46, left: 32, right: 32 };
const FONT_NAME = "CJK";
const COLOR_TEXT = "#111111";
const COLOR_NEGATIVE = "#dc2626";
const COLOR_SECTION_TITLE = "#dc2626";
const COLOR_GROUP_HEADER_BG = "#dbeafe";
const COLOR_GROUP_HEADER_TEXT = "#1d4ed8";
const COLOR_COLUMN_HEADER_BG = "#cbd5e1";
const COLOR_SUBTOTAL_BG = "#ffedd5";
const COLOR_TOTAL_BG = "#fef08a";
const COLOR_BORDER = "#94a3b8";
const COLOR_DISCLAIMER = "#92400e";
const COLOR_PROVISIONAL = "#dc2626";

const HEADER_GROUP_ROW_HEIGHT = 20;
const HEADER_LABEL_ROW_HEIGHT = 20;
const BODY_ROW_HEIGHT = 15;
const SECTION_TITLE_HEIGHT = 18;
const CELL_PADDING_X = 4;

interface RenderContext {
  doc: PDFKit.PDFDocument;
  contentLeft: number;
  contentRight: number;
  contentWidth: number;
  contentBottom: number;
  y: number;
  meta: ReportMeta;
}

function cellDisplay(cell: RawCell): { text: string; negative: boolean; align: "left" | "right" } {
  switch (cell.kind) {
    case "text":
      return { text: cell.value, negative: false, align: cell.align ?? "left" };
    case "amount": {
      const f = formatAmountCell(cell.value);
      return { text: f.text, negative: f.negative, align: "right" };
    }
    case "count": {
      const f = formatCountCell(cell.value);
      return { text: f.text, negative: f.negative, align: "right" };
    }
    case "growth": {
      const f = formatGrowthRateCell(cell.value);
      return { text: f.text, negative: f.negative, align: "right" };
    }
    case "date": {
      // Never produced by the old single-department builders this PDF
      // reads (they emit a pre-formatted text cell for dates instead) - see
      // RawCell's own doc comment in summaryReportData.ts. Handled here
      // only so the switch stays exhaustive if that ever changes; reads
      // back the UTC-midnight instant taipeiDateOnly() encodes directly,
      // no timezone conversion needed.
      if (cell.value === null) return { text: "—", negative: false, align: "right" };
      const y = cell.value.getUTCFullYear();
      const m = String(cell.value.getUTCMonth() + 1).padStart(2, "0");
      const d = String(cell.value.getUTCDate()).padStart(2, "0");
      return { text: `${y}.${m}.${d}`, negative: false, align: "right" };
    }
  }
}

function scaledColWidths(baseWidths: number[], contentWidth: number): number[] {
  const total = baseWidths.reduce((a, b) => a + b, 0);
  const scale = contentWidth / total;
  return baseWidths.map((w) => w * scale);
}

/**
 * pdfkit's `lineBreak: false` does NOT actually suppress width-based
 * wrapping in this version (verified against node_modules/pdfkit/js -
 * lineBreak only skips computing a *default* width when none is given; if
 * a width is passed, normal word-wrap still applies regardless). A long
 * cell label (e.g. a 單位別 block's "OOO 體系小計（暫計，尚有未編製部門）"
 * row) would otherwise wrap onto a second line and blow out the fixed row
 * height. Instead of fighting pdfkit's wrap logic, shrink the font just
 * enough that the text's own measured width fits in one line.
 */
function fitFontSize(doc: PDFKit.PDFDocument, text: string, maxWidth: number, baseSize: number, minSize = 5): number {
  let size = baseSize;
  doc.fontSize(size);
  if (maxWidth <= 0) return size;
  while (size > minSize && doc.widthOfString(text) > maxWidth) {
    size -= 0.5;
    doc.fontSize(size);
  }
  return size;
}

function drawPageFrame(ctx: RenderContext, reportTypeLabel: string) {
  const { doc, contentLeft, contentWidth } = ctx;
  const top = ctx.doc.page.margins.top;
  doc.font(FONT_NAME).fontSize(12).fillColor(COLOR_TEXT);
  doc.text(ctx.meta.title, contentLeft, top - 42, { width: contentWidth, lineBreak: false, height: 200 });
  doc.fontSize(8).fillColor("#475569");
  doc.text(reportTypeLabel, contentLeft, top - 24, { width: contentWidth, lineBreak: false, height: 200 });
}

/** Draws the two-row column header (group row + label row) at ctx.y, advances ctx.y past it. */
function drawColumnHeader(ctx: RenderContext, table: RawTable, colWidths: number[]) {
  const { doc, contentLeft } = ctx;
  let x = contentLeft;
  const groupY = ctx.y;
  doc.font(FONT_NAME).fontSize(8);
  // Compute each group's pixel width by summing the span's column widths.
  let colIdx = 0;
  for (const g of table.headerGroups) {
    const groupWidth = colWidths.slice(colIdx, colIdx + g.span).reduce((a, b) => a + b, 0);
    doc.rect(x, groupY, groupWidth, HEADER_GROUP_ROW_HEIGHT).fillAndStroke(COLOR_GROUP_HEADER_BG, COLOR_BORDER);
    doc.font(FONT_NAME).fillColor(COLOR_GROUP_HEADER_TEXT);
    const availableW = groupWidth - CELL_PADDING_X * 2;
    fitFontSize(doc, g.label, availableW, 8);
    doc.text(g.label, x + CELL_PADDING_X, groupY + 6, { width: availableW, align: "center", height: 200 });
    x += groupWidth;
    colIdx += g.span;
  }
  ctx.y += HEADER_GROUP_ROW_HEIGHT;

  const labelY = ctx.y;
  x = contentLeft;
  table.headerLabels.forEach((label, i) => {
    const w = colWidths[i] ?? 0;
    doc.rect(x, labelY, w, HEADER_LABEL_ROW_HEIGHT).fillAndStroke(COLOR_COLUMN_HEADER_BG, COLOR_BORDER);
    doc.font(FONT_NAME).fillColor(COLOR_TEXT);
    const availableW = w - CELL_PADDING_X * 2;
    fitFontSize(doc, label, availableW, 7.5);
    doc.text(label, x + CELL_PADDING_X, labelY + 6, { width: availableW, align: "center", height: 200 });
    x += w;
  });
  ctx.y += HEADER_LABEL_ROW_HEIGHT;
}

function drawSectionTitle(ctx: RenderContext, title: string) {
  const { doc, contentLeft, contentWidth } = ctx;
  doc.font(FONT_NAME).fontSize(10).fillColor(COLOR_SECTION_TITLE);
  doc.text(title, contentLeft, ctx.y + 2, { width: contentWidth, lineBreak: false, height: 200 });
  ctx.y += SECTION_TITLE_HEIGHT;
}

function rowBackground(style: RawRow["style"]): string | null {
  if (style === "subtotal") return COLOR_SUBTOTAL_BG;
  if (style === "total") return COLOR_TOTAL_BG;
  return null;
}

function drawRow(ctx: RenderContext, row: RawRow, colWidths: number[]) {
  const { doc, contentLeft } = ctx;
  const bg = rowBackground(row.style);
  const bold = row.style !== "normal";
  let x = contentLeft;
  row.cells.forEach((cell, i) => {
    const w = colWidths[i] ?? 0;
    const { text, negative, align } = cellDisplay(cell);
    if (bg) {
      doc.rect(x, ctx.y, w, BODY_ROW_HEIGHT).fillAndStroke(bg, COLOR_BORDER);
    } else {
      doc.rect(x, ctx.y, w, BODY_ROW_HEIGHT).fillAndStroke("#ffffff", "#e2e8f0");
    }
    doc.font(FONT_NAME).fillColor(negative ? COLOR_NEGATIVE : COLOR_TEXT);
    const availableW = w - CELL_PADDING_X * 2;
    const size = fitFontSize(doc, text, availableW, 7.5);
    const textY = ctx.y + (BODY_ROW_HEIGHT - size) / 2 + 1;
    doc.text(text, x + CELL_PADDING_X, textY, { width: availableW, align, height: 200, ellipsis: false });
    if (bold) {
      // pdfkit's embedded TTF has no separate bold cut - approximate
      // emphasis by re-stroking the text once more (a cheap "faux bold").
      doc.text(text, x + CELL_PADDING_X + 0.3, textY, { width: availableW, align, height: 200, ellipsis: false });
    }
    x += w;
  });
  ctx.y += BODY_ROW_HEIGHT;
}

/**
 * Groups body rows into atomic units that must never be split across a
 * page break - each category's detail rows plus its own subtotal row, and
 * a trailing total row (which never has detail rows of its own) glued onto
 * the block before it. Prevents "小計與總計不可被拆成只有總計列留在下一頁"
 * (a lone total row stranded alone at the top of a new page).
 */
function groupRowsIntoBlocks(rows: RawRow[]): RawRow[][] {
  const blocks: RawRow[][] = [];
  let current: RawRow[] = [];
  for (const row of rows) {
    if (row.style === "total" && current.length === 0 && blocks.length > 0) {
      blocks[blocks.length - 1]!.push(row);
      continue;
    }
    current.push(row);
    if (row.style === "subtotal" || row.style === "total") {
      blocks.push(current);
      current = [];
    }
  }
  if (current.length) blocks.push(current);
  return blocks;
}

function ensureSpace(ctx: RenderContext, neededHeight: number, table: RawTable, colWidths: number[], reportTypeLabel: string) {
  if (ctx.y + neededHeight <= ctx.contentBottom) return;
  ctx.doc.addPage();
  ctx.y = ctx.doc.page.margins.top;
  drawPageFrame(ctx, reportTypeLabel);
  drawColumnHeader(ctx, table, colWidths);
}

/** Renders one RawTable (optionally preceded by a red section title) starting at ctx.y, paginating as needed. */
function renderTable(ctx: RenderContext, table: RawTable, colWidths: number[], reportTypeLabel: string, sectionTitle?: string) {
  const headerHeight = HEADER_GROUP_ROW_HEIGHT + HEADER_LABEL_ROW_HEIGHT;
  const titleHeight = sectionTitle ? SECTION_TITLE_HEIGHT : 0;
  ensureSpace(ctx, titleHeight + headerHeight + BODY_ROW_HEIGHT, table, colWidths, reportTypeLabel);

  if (sectionTitle) drawSectionTitle(ctx, sectionTitle);
  drawColumnHeader(ctx, table, colWidths);

  const blocks = groupRowsIntoBlocks(table.rows);
  for (const block of blocks) {
    const blockHeight = block.length * BODY_ROW_HEIGHT;
    if (ctx.y + blockHeight > ctx.contentBottom) {
      if (blockHeight > ctx.contentBottom - (ctx.doc.page.margins.top + headerHeight)) {
        // Pathological case (shouldn't happen with this fixed dataset): a
        // single block taller than a full page - fall back to splitting it
        // row-by-row rather than looping forever.
        for (const row of block) {
          ensureSpace(ctx, BODY_ROW_HEIGHT, table, colWidths, reportTypeLabel);
          drawRow(ctx, row, colWidths);
        }
        continue;
      }
      ctx.doc.addPage();
      ctx.y = ctx.doc.page.margins.top;
      drawPageFrame(ctx, reportTypeLabel);
      drawColumnHeader(ctx, table, colWidths);
    }
    for (const row of block) drawRow(ctx, row, colWidths);
  }
}

function drawMetaBlock(ctx: RenderContext) {
  const { doc, contentLeft, contentWidth, meta } = ctx;
  doc.font(FONT_NAME).fontSize(16).fillColor(COLOR_TEXT);
  doc.text(meta.title, contentLeft, ctx.y, { width: contentWidth, lineBreak: false, height: 200 });
  ctx.y += 22;

  doc.fontSize(9);
  doc.text(`報表種類：${meta.reportTypeLabel}`, contentLeft, ctx.y, { width: contentWidth, lineBreak: false, height: 200 });
  ctx.y += 13;

  doc.text(`資料範圍：${meta.scopeLabel}　　資料截至：${meta.asOfLabel}　　匯出時間：${meta.exportedAtLabel}`, contentLeft, ctx.y, {
    width: contentWidth,
    lineBreak: false, height: 200,
  });
  ctx.y += 13;

  doc.fillColor(COLOR_DISCLAIMER).fontSize(8);
  doc.text(TEMPLATE_FIGURES_DISCLAIMER, contentLeft, ctx.y, { width: contentWidth, lineBreak: false, height: 200 });
  ctx.y += 12;

  const note = provisionalNoteIfIncomplete(meta);
  if (note) {
    doc.fillColor(COLOR_PROVISIONAL).font(FONT_NAME).fontSize(9);
    doc.text(note, contentLeft, ctx.y, { width: contentWidth, lineBreak: false, height: 200 });
    ctx.y += 13;
  }
  doc.fillColor(COLOR_TEXT);
  ctx.y += 6;
}

function drawFooters(doc: PDFKit.PDFDocument, exportedAtLabel: string) {
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let i = 0; i < total; i++) {
    doc.switchToPage(range.start + i);
    const page = doc.page;
    const y = page.height - page.margins.bottom + 16;
    doc
      .font(FONT_NAME)
      .fontSize(7.5)
      .fillColor("#475569")
      .text(`匯出日期：${exportedAtLabel}`, page.margins.left, y, { width: 200, lineBreak: false, height: 200 })
      .text(`第 ${i + 1} 頁，共 ${total} 頁`, page.width - page.margins.right - 150, y, {
        width: 150,
        align: "right",
        lineBreak: false, height: 200,
      });
  }
}

// ---------------------------------------------------------------------------
// Column widths (points, base values before auto-scaling to page width).
// ---------------------------------------------------------------------------
const UNIT_BASE_WIDTHS = [130, 55, 85, 60, 85, 80, 95, 85, 60, 65, 85];
const ACCOUNT_BASE_WIDTHS = [35, 130, 85, 85, 85, 95, 85, 75, 85, 75];
const COMPANY_BASE_WIDTHS = [160, 90, 90, 90, 90, 90, 70];

export interface BuildPdfInput {
  financeDepartment: { code: string; name: string } | null;
  financeVersion: FinanceVersionDto | null;
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

function newDocument(): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    size: "A3",
    layout: "landscape",
    margins: PAGE_MARGIN,
    bufferPages: true,
    autoFirstPage: true,
    info: { Title: "2027年度費用預算彙總表（版型預覽）" },
  });
  doc.registerFont(FONT_NAME, getCjkFontBuffer());
  doc.font(FONT_NAME);
  return doc;
}

function newContext(doc: PDFKit.PDFDocument, meta: ReportMeta): RenderContext {
  const contentLeft = doc.page.margins.left;
  const contentRight = doc.page.width - doc.page.margins.right;
  return {
    doc,
    contentLeft,
    contentRight,
    contentWidth: contentRight - contentLeft,
    contentBottom: doc.page.height - doc.page.margins.bottom,
    y: doc.page.margins.top,
    meta,
  };
}

function renderSingleTableSection(
  ctx: RenderContext,
  tableKey: ExportTableKey,
  table: RawTable,
  baseWidths: number[],
  sectionTitle?: string
) {
  const colWidths = scaledColWidths(baseWidths, ctx.contentWidth);
  drawMetaBlock(ctx);
  renderTable(ctx, table, colWidths, ctx.meta.reportTypeLabel, sectionTitle);
}

export async function buildBudgetSummaryPreviewPdf(tableKey: ExportTableKey, input: BuildPdfInput): Promise<Buffer> {
  const doc = newDocument();
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const meta = buildReportMeta(tableKey, input.financeVersion, input.scope, input.exportedAtIso, formatTaipeiDate);
  const ctx = newContext(doc, meta);

  if (tableKey === "full") {
    // 1. 全公司費用合計
    {
      const m = buildReportMeta("company", input.financeVersion, input.scope, input.exportedAtIso, formatTaipeiDate);
      ctx.meta = m;
      renderSingleTableSection(ctx, "company", buildCompanySummaryTable(input.financeVersion, input.scope), COMPANY_BASE_WIDTHS);
    }
    // 2. 單位別費用與編制
    doc.addPage();
    ctx.y = doc.page.margins.top;
    {
      const m = buildReportMeta("unit-all", input.financeVersion, input.scope, input.exportedAtIso, formatTaipeiDate);
      ctx.meta = m;
      drawMetaBlock(ctx);
      const colWidths = scaledColWidths(UNIT_BASE_WIDTHS, ctx.contentWidth);
      for (const block of UNIT_BLOCKS) {
        const table = buildUnitBlockTable(block, input.financeDepartment?.name ?? null, input.financeVersion, input.scope, formatTaipeiDate);
        renderTable(ctx, table, colWidths, m.reportTypeLabel, block.title);
        ctx.y += 8;
      }
    }
    // 3. 管銷研科目彙總
    doc.addPage();
    ctx.y = doc.page.margins.top;
    {
      const m = buildReportMeta("sga", input.financeVersion, input.scope, input.exportedAtIso, formatTaipeiDate);
      ctx.meta = m;
      renderSingleTableSection(ctx, "sga", buildSgaTable(input.financeVersion, input.scope), ACCOUNT_BASE_WIDTHS);
    }
    // 4. 生產科目彙總
    doc.addPage();
    ctx.y = doc.page.margins.top;
    {
      const m = buildReportMeta("production", input.financeVersion, input.scope, input.exportedAtIso, formatTaipeiDate);
      ctx.meta = m;
      renderSingleTableSection(ctx, "production", buildProductionTable(), ACCOUNT_BASE_WIDTHS);
    }
    // 5. 報表說明
    doc.addPage();
    ctx.y = doc.page.margins.top;
    {
      doc.font(FONT_NAME).fontSize(14).fillColor(COLOR_TEXT);
      doc.text("2027年度費用預算彙總表 - 報表說明", ctx.contentLeft, ctx.y, { width: ctx.contentWidth });
      ctx.y += 24;
      doc.fontSize(9);
      const lines = [
        "版型預覽說明：",
        `・${TEMPLATE_FIGURES_DISCLAIMER}`,
        "・僅財務管理處為實際測試資料，其他部門尚未匯入，一律顯示「—」（絕不顯示為 0）。",
        "・「2026推估」僅來自 fiscalYear=2027 之 BudgetVersion 本身的 priorYearOriginalBudget（即 Account.priorYearReferenceAmount）。",
        "・現有 fiscalYear=2026（或其他年度）之 BudgetVersion 絕不會顯示於「2027目標」欄位。",
        `・資料範圍：${meta.scopeLabel}`,
        `・資料截至：${meta.asOfLabel}`,
        `・匯出時間：${meta.exportedAtLabel}`,
        "・本檔案完全由系統唯讀查詢產生，匯出動作本身不會新增、刪除或修改任何資料庫資料。",
      ];
      for (const line of lines) {
        doc.text(line, ctx.contentLeft, ctx.y, { width: ctx.contentWidth });
        ctx.y += 16;
      }
    }
  } else if (tableKey.startsWith("unit-") && tableKey !== "unit-all") {
    const block = unitBlockKeyToBlock(tableKey);
    if (!block) throw new Error(`unknown unit block key: ${tableKey}`);
    const table = buildUnitBlockTable(block, input.financeDepartment?.name ?? null, input.financeVersion, input.scope, formatTaipeiDate);
    renderSingleTableSection(ctx, tableKey, table, UNIT_BASE_WIDTHS, block.title);
  } else if (tableKey === "unit-all") {
    drawMetaBlock(ctx);
    const colWidths = scaledColWidths(UNIT_BASE_WIDTHS, ctx.contentWidth);
    for (const block of UNIT_BLOCKS) {
      const table = buildUnitBlockTable(block, input.financeDepartment?.name ?? null, input.financeVersion, input.scope, formatTaipeiDate);
      renderTable(ctx, table, colWidths, meta.reportTypeLabel, block.title);
      ctx.y += 8;
    }
  } else if (tableKey === "sga") {
    renderSingleTableSection(ctx, "sga", buildSgaTable(input.financeVersion, input.scope), ACCOUNT_BASE_WIDTHS);
  } else if (tableKey === "production") {
    renderSingleTableSection(ctx, "production", buildProductionTable(), ACCOUNT_BASE_WIDTHS);
  } else if (tableKey === "company") {
    renderSingleTableSection(ctx, "company", buildCompanySummaryTable(input.financeVersion, input.scope), COMPANY_BASE_WIDTHS);
  } else {
    throw new Error(`unsupported PDF export key: ${tableKey}`);
  }

  drawFooters(doc, formatTaipeiDate(input.exportedAtIso));
  doc.end();
  return done;
}
