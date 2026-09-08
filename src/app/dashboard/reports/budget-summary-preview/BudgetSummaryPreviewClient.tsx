"use client";

import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { AccountCommonCategory, BudgetStatus } from "@prisma/client";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/lib/budget/categorySummary";
import { sumDecimals, growthRate } from "@/lib/money/decimal";
import { formatAmountCell, formatCountCell, formatGrowthRateCell } from "@/lib/reports/summaryFormat";
import { UNIT_BLOCKS, PRODUCTION_PLACEHOLDER_ROWS } from "@/lib/reports/budgetSummaryPreviewData";
import { formatTaipeiDate } from "@/lib/format/date";

interface FinanceLineDto {
  id: string;
  priorYearOriginalBudget: string;
  nextYearTargetExcludingNew: string;
  nextYearNewHireBudget: string;
  nextYearTotal: string;
  account: { sourceSeq: number | null; name: string; commonCategory: AccountCommonCategory };
}

interface FinanceVersionDto {
  id: string;
  status: BudgetStatus;
  priorYearHeadcount: number;
  budgetYearHeadcount: number;
  lastPreparedAt: string;
  lines: FinanceLineDto[];
}

const STATUS_LABEL: Record<string, string> = {
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
      boxShadow: frozen && colIndex === frozenColCount - 1 ? "2px 0 4px -2px rgba(15,23,42,0.35)" : undefined,
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

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 mt-6 text-sm font-bold first:mt-0" style={{ color: COLOR.sectionTitle }}>
      {children}
    </h3>
  );
}

export function BudgetSummaryPreviewClient({
  financeDepartment,
  financeVersion,
}: {
  financeDepartment: { code: string; name: string } | null;
  financeVersion: FinanceVersionDto | null;
}) {
  const [tab, setTab] = useState<TabKey>("unit");

  const financeAgg = useMemo(() => buildFinanceAgg(financeVersion), [financeVersion]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <h1 className="mb-1 text-xl font-bold">費用預算彙總表（版型預覽）</h1>
      <p className="mb-4 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
        版型預覽：目前僅財務管理處為實際測試資料，其他部門尚未匯入。
      </p>

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

      {tab === "unit" && <UnitTab financeDepartment={financeDepartment} financeVersion={financeVersion} financeAgg={financeAgg} />}
      {tab === "sga" && <SgaTab financeVersion={financeVersion} financeAgg={financeAgg} />}
      {tab === "production" && <ProductionTab financeAgg={financeAgg} />}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Tab 1: 單位別費用與編制
// ---------------------------------------------------------------------------

// Deliberately wide enough to require horizontal scroll within the page's
// max-w-7xl content area at every tested viewport (1366/1440/1920px) -
// matches the dense financial-report style of the reference spreadsheet
// (spec §六) and exercises the frozen 部門 column / frozen header.
const UNIT_COL_WIDTHS = [160, 90, 140, 90, 140, 130, 150, 130, 110, 100, 150];
const UNIT_HEADER_GROUPS: HeaderGroup[] = [
  { label: "部門", span: 1 },
  { label: "2025推估", span: 2 },
  { label: "2026目標計畫", span: 4 },
  { label: "與2025比較", span: 2 },
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

function UnitTab({
  financeDepartment,
  financeVersion,
  financeAgg,
}: {
  financeDepartment: { code: string; name: string } | null;
  financeVersion: FinanceVersionDto | null;
  financeAgg: ReturnType<typeof buildFinanceAgg>;
}) {
  return (
    <div>
      {UNIT_BLOCKS.map((block) => {
        const rows: TableRow[] = block.departments.map((name) => {
          const isFinance = financeDepartment && name === financeDepartment.name && financeVersion && financeAgg;
          if (isFinance && financeVersion && financeAgg) {
            return {
              cells: [
                textCell(name),
                cell(formatCountCell(financeVersion.priorYearHeadcount).text),
                { ...formatAmountCell(financeAgg.priorTotal) },
                cell(formatCountCell(financeVersion.budgetYearHeadcount).text),
                { ...formatAmountCell(financeAgg.excludingNewTotal) },
                { ...formatAmountCell(financeAgg.newHireTotal) },
                { ...formatAmountCell(financeAgg.grandTotal) },
                { ...formatAmountCell(financeAgg.delta) },
                { ...formatGrowthRateCell(financeAgg.growth) },
                cell(STATUS_LABEL[financeVersion.status] ?? financeVersion.status, false, "left"),
                cell(formatTaipeiDate(financeVersion.lastPreparedAt), false, "left"),
              ],
            };
          }
          return {
            cells: [
              textCell(name),
              cell("—"),
              cell("—"),
              cell("—"),
              cell("—"),
              cell("—"),
              cell("—"),
              cell("—"),
              cell("—"),
              cell("未編製", false, "left"),
              cell("—", false, "left"),
            ],
          };
        });

        // 體系小計 - only sums departments with real data (currently at most 財務管理處).
        const realInBlock = block.departments.includes(financeDepartment?.name ?? " ") && financeAgg && financeVersion;
        const subtotalRow: TableRow = {
          background: COLOR.subtotalBg,
          bold: true,
          cells: realInBlock
            ? [
                textCell(`${block.title.split("、")[1] ?? block.title} 體系小計（暫計，尚有未編製部門）`),
                cell(formatCountCell(financeVersion!.priorYearHeadcount).text),
                { ...formatAmountCell(financeAgg!.priorTotal) },
                cell(formatCountCell(financeVersion!.budgetYearHeadcount).text),
                { ...formatAmountCell(financeAgg!.excludingNewTotal) },
                { ...formatAmountCell(financeAgg!.newHireTotal) },
                { ...formatAmountCell(financeAgg!.grandTotal) },
                { ...formatAmountCell(financeAgg!.delta) },
                { ...formatGrowthRateCell(financeAgg!.growth) },
                textCell(""),
                textCell(""),
              ]
            : [
                textCell(`${block.title.split("、")[1] ?? block.title} 體系小計（暫計，尚有未編製部門）`),
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
            <SectionTitle>{block.title}</SectionTitle>
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

// ---------------------------------------------------------------------------
// Tab 2 / Tab 3 shared column layout
// ---------------------------------------------------------------------------

// Same rationale as UNIT_COL_WIDTHS above - wide enough to require
// horizontal scroll and demonstrate the frozen 序／項目 columns.
const ACCOUNT_COL_WIDTHS = [60, 220, 130, 130, 130, 140, 130, 120, 130, 120];
const ACCOUNT_HEADER_GROUPS: HeaderGroup[] = [
  { label: "基本資料", span: 2 },
  { label: "2025推估", span: 1 },
  { label: "2026目標計畫", span: 3 },
  { label: "與2025比較", span: 4 },
];
const ACCOUNT_HEADER_LABELS = [
  "序",
  "項目",
  "金額",
  "不含新員",
  "新員預算",
  "合計（含新員）",
  "不含新員增減",
  "不含新員成長率",
  "含新員增減",
  "含新員成長率",
];

function buildFinanceAgg(financeVersion: FinanceVersionDto | null) {
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

function metricsForLines(lines: FinanceLineDto[]) {
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

function metricsRowCells(seq: string, name: string, m: ReturnType<typeof metricsForLines>): Cell[] {
  return [
    cell(seq, false, "left"),
    textCell(name),
    { ...formatAmountCell(m.prior) },
    { ...formatAmountCell(m.excludingNew) },
    { ...formatAmountCell(m.newHire) },
    { ...formatAmountCell(m.total) },
    { ...formatAmountCell(m.deltaExcl) },
    { ...formatGrowthRateCell(m.growthExcl) },
    { ...formatAmountCell(m.deltaTotal) },
    { ...formatGrowthRateCell(m.growthTotal) },
  ];
}

// ---------------------------------------------------------------------------
// Tab 2: 管銷研科目彙總 (營業＋管理＋研發 - 排除生產)
// ---------------------------------------------------------------------------

function SgaTab({
  financeVersion,
  financeAgg,
}: {
  financeVersion: FinanceVersionDto | null;
  financeAgg: ReturnType<typeof buildFinanceAgg>;
}) {
  const rows: TableRow[] = [];

  if (financeVersion && financeAgg) {
    // 1. 平均人數 - headcount, displayed in the same money-shaped columns as every other row.
    rows.push({
      cells: [
        cell("—", false, "left"),
        textCell("平均人數"),
        { ...formatCountCell(financeVersion.priorYearHeadcount) },
        { ...formatCountCell(financeVersion.budgetYearHeadcount) },
        cell("—"),
        { ...formatCountCell(financeVersion.budgetYearHeadcount) },
        cell("—"),
        cell("—"),
        cell("—"),
        cell("—"),
      ],
    });

    // 2. 管銷研費用 - running grand-total summary row, positioned right after headcount.
    rows.push({
      background: COLOR.totalBg,
      bold: true,
      cells: metricsRowCells("—", "管銷研費用（目前僅財務管理處）", metricsForLines(financeVersion.lines)),
    });

    // 3-7. detail accounts per category, each followed by its subtotal.
    for (const category of CATEGORY_ORDER) {
      const linesInCategory = financeVersion.lines
        .filter((l) => l.account.commonCategory === category)
        .sort((a, b) => (a.account.sourceSeq ?? 0) - (b.account.sourceSeq ?? 0));
      for (const line of linesInCategory) {
        rows.push({
          cells: metricsRowCells(String(line.account.sourceSeq ?? "—"), line.account.name, metricsForLines([line])),
        });
      }
      rows.push({
        background: COLOR.subtotalBg,
        bold: true,
        cells: metricsRowCells("—", `${CATEGORY_LABELS[category]}小計`, metricsForLines(linesInCategory)),
      });
    }

    // 8. 管銷研費用總計
    rows.push({
      background: COLOR.totalBg,
      bold: true,
      cells: metricsRowCells("—", "管銷研費用總計", metricsForLines(financeVersion.lines)),
    });
  }

  return (
    <div>
      <p className="mb-3 text-sm text-slate-600">
        管銷研範圍：營業單位（含海外單位）、管理單位、研發單位——<strong>排除所有生產單位</strong>。
        目前僅包含財務管理處測試資料，尚非全公司最終管銷研合計；其他部門尚未編製時不計入合計。
      </p>
      <SummaryBanner sgaAgg={financeAgg} />
      {financeVersion ? (
        <StickyReportTable
          frozenColCount={2}
          colWidths={ACCOUNT_COL_WIDTHS}
          headerGroups={ACCOUNT_HEADER_GROUPS}
          headerLabels={ACCOUNT_HEADER_LABELS}
          rows={rows}
          maxHeightPx={560}
        />
      ) : (
        <p className="rounded border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
          財務管理處尚無可讀取的預算資料（尚未初始化 DEMO 主檔或尚未建立預算版本）。
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 3: 生產科目彙總 - no production data exists yet, every figure is "—".
// ---------------------------------------------------------------------------

function ProductionTab({ financeAgg }: { financeAgg: ReturnType<typeof buildFinanceAgg> }) {
  const rows: TableRow[] = PRODUCTION_PLACEHOLDER_ROWS.map((r) => ({
    background: r.kind === "total" ? COLOR.totalBg : r.kind === "subtotal" ? COLOR.subtotalBg : undefined,
    bold: r.kind !== "detail",
    cells: [
      cell("—", false, "left"),
      textCell(r.label),
      cell("—"),
      cell("—"),
      cell("—"),
      cell("—"),
      cell("—"),
      cell("—"),
      cell("—"),
      cell("—"),
    ],
  }));

  return (
    <div>
      <p className="mb-3 text-sm text-slate-600">生產費用獨立列示，不併入管銷研。</p>
      <SummaryBanner sgaAgg={financeAgg} />
      <p className="mb-3 rounded bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">狀態：尚未匯入生產部門資料</p>
      <StickyReportTable
        frozenColCount={2}
        colWidths={ACCOUNT_COL_WIDTHS}
        headerGroups={ACCOUNT_HEADER_GROUPS}
        headerLabels={ACCOUNT_HEADER_LABELS}
        rows={rows}
        maxHeightPx={400}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared 全公司費用合計區 banner, shown above the 管銷研/生產 account tables.
// ---------------------------------------------------------------------------

function SummaryBanner({ sgaAgg }: { sgaAgg: ReturnType<typeof buildFinanceAgg> }) {
  const colWidths = [160, 100, 100, 100, 100, 100, 90];
  const headerGroups: HeaderGroup[] = [{ label: "全公司費用合計區", span: 7 }];
  const headerLabels = ["項目", "2025推估", "2026不含新員", "2026新員", "2026合計", "增減金額", "增減率"];

  const sgaRow: TableRow = sgaAgg
    ? {
        background: COLOR.subtotalBg,
        bold: true,
        cells: [
          textCell("管銷研費用合計（暫計，僅財務管理處）"),
          { ...formatAmountCell(sgaAgg.priorTotal) },
          { ...formatAmountCell(sgaAgg.excludingNewTotal) },
          { ...formatAmountCell(sgaAgg.newHireTotal) },
          { ...formatAmountCell(sgaAgg.grandTotal) },
          { ...formatAmountCell(sgaAgg.delta) },
          { ...formatGrowthRateCell(sgaAgg.growth) },
        ],
      }
    : {
        background: COLOR.subtotalBg,
        bold: true,
        cells: [textCell("管銷研費用合計（暫計）"), cell("—"), cell("—"), cell("—"), cell("—"), cell("—"), cell("—")],
      };

  const productionRow: TableRow = {
    cells: [textCell("生產費用合計"), cell("—"), cell("—"), cell("—"), cell("—"), cell("—"), cell("—")],
  };

  const grandRow: TableRow = {
    background: COLOR.totalBg,
    bold: true,
    cells: [textCell("全公司費用總計"), cell("—"), cell("—"), cell("—"), cell("—"), cell("—"), cell("—")],
  };

  return (
    <div className="mb-4">
      <StickyReportTable
        frozenColCount={1}
        colWidths={colWidths}
        headerGroups={headerGroups}
        headerLabels={headerLabels}
        rows={[sgaRow, productionRow, grandRow]}
        maxHeightPx={220}
      />
      <p className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
        勾稽狀態：全公司費用尚無法完成彙總：生產單位資料尚未匯入。（正式階段公式：管銷研費用合計＋生產費用合計＝全公司費用總計）
      </p>
    </div>
  );
}
