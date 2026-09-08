import { describe, it, expect } from "vitest";
import {
  isStatusInScope,
  financeVersionInScope,
  financeNotInScopeStatusLabel,
  isBudgetDataScope,
  isExportTableKey,
  EXPORT_TABLE_KEYS,
  EXPORT_TABLE_TITLES,
  EXPORT_FILENAME_LABELS,
  buildUnitBlockTable,
  buildSgaTable,
  buildProductionTable,
  buildCompanySummaryTable,
  buildReportMeta,
  provisionalNoteIfIncomplete,
  type FinanceVersionDto,
  type RawCell,
} from "@/lib/reports/summaryReportData";
import { UNIT_BLOCKS, TARGET_YEAR_NOT_PREPARED_LABEL } from "@/lib/reports/budgetSummaryPreviewData";
import { DEMO_DEPARTMENT_NAME } from "@/lib/demo/constants";
import { sanitizeCellText } from "@/lib/excel/sanitize";
import type { BudgetStatus } from "@prisma/client";

const formatDate = (iso: string) => iso.slice(0, 10);

/** Test-only helper: extract a text cell's string value, failing loudly if the cell isn't text-shaped. */
function textOf(cell: RawCell | undefined): string {
  if (!cell || cell.kind !== "text") throw new Error(`expected a text cell, got ${JSON.stringify(cell)}`);
  return cell.value;
}

function makeFinanceVersion(status: BudgetStatus): FinanceVersionDto {
  return {
    id: "v1",
    status,
    priorYearHeadcount: 10,
    budgetYearHeadcount: 12,
    lastPreparedAt: "2026-09-08T00:00:00.000Z",
    lines: [
      {
        id: "l1",
        priorYearOriginalBudget: "1000000",
        nextYearTargetExcludingNew: "500000",
        nextYearNewHireBudget: "200000",
        nextYearTotal: "700000",
        account: { sourceSeq: 3, name: "薪資支出", commonCategory: "PERSONNEL" },
      },
      {
        id: "l2",
        priorYearOriginalBudget: "0",
        nextYearTargetExcludingNew: "0",
        nextYearNewHireBudget: "0",
        nextYearTotal: "0",
        account: { sourceSeq: 21, name: "交通費", commonCategory: "SG_AND_A" },
      },
    ],
  };
}

describe("資料範圍 (BudgetDataScope) filtering", () => {
  it("包含草稿 accepts every status", () => {
    const statuses: BudgetStatus[] = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "RETURNED", "APPROVED", "LOCKED", "REJECTED"];
    for (const s of statuses) expect(isStatusInScope(s, "draft_included")).toBe(true);
  });

  it("僅已送出 excludes DRAFT, RETURNED and REJECTED but accepts a version that has actually been submitted", () => {
    expect(isStatusInScope("DRAFT", "submitted")).toBe(false);
    expect(isStatusInScope("RETURNED", "submitted")).toBe(false);
    expect(isStatusInScope("REJECTED", "submitted")).toBe(false);
    expect(isStatusInScope("SUBMITTED", "submitted")).toBe(true);
    expect(isStatusInScope("UNDER_REVIEW", "submitted")).toBe(true);
    expect(isStatusInScope("APPROVED", "submitted")).toBe(true);
    expect(isStatusInScope("LOCKED", "submitted")).toBe(true);
  });

  it("僅已核准 accepts only APPROVED/LOCKED/ADJUSTED", () => {
    expect(isStatusInScope("APPROVED", "approved")).toBe(true);
    expect(isStatusInScope("LOCKED", "approved")).toBe(true);
    expect(isStatusInScope("ADJUSTED", "approved")).toBe(true);
    expect(isStatusInScope("SUBMITTED", "approved")).toBe(false);
    expect(isStatusInScope("DRAFT", "approved")).toBe(false);
  });

  it("financeVersionInScope returns null when there is no version at all", () => {
    expect(financeVersionInScope(null, "draft_included")).toBeNull();
  });

  it("financeVersionInScope returns null when a version exists but its status is outside the selected scope", () => {
    const v = makeFinanceVersion("DRAFT");
    expect(financeVersionInScope(v, "submitted")).toBeNull();
    expect(financeVersionInScope(v, "draft_included")).toBe(v);
  });

  it("financeNotInScopeStatusLabel distinguishes 'no 2027 version at all' from 'version exists but filtered out by scope'", () => {
    expect(financeNotInScopeStatusLabel(null, "draft_included")).toBe(TARGET_YEAR_NOT_PREPARED_LABEL);
    const v = makeFinanceVersion("DRAFT");
    const label = financeNotInScopeStatusLabel(v, "submitted");
    expect(label).not.toBe(TARGET_YEAR_NOT_PREPARED_LABEL);
    expect(label).toContain("草稿");
    expect(label).toContain("僅已送出");
  });

  it("isBudgetDataScope rejects anything not in the fixed option list", () => {
    expect(isBudgetDataScope("draft_included")).toBe(true);
    expect(isBudgetDataScope("submitted")).toBe(true);
    expect(isBudgetDataScope("approved")).toBe(true);
    expect(isBudgetDataScope("all")).toBe(false);
    expect(isBudgetDataScope("")).toBe(false);
    expect(isBudgetDataScope("DRAFT_INCLUDED")).toBe(false);
  });
});

describe("匯出表格 key validation (guards the export API's ?table= query param)", () => {
  it("isExportTableKey accepts every key in EXPORT_TABLE_KEYS and rejects anything else", () => {
    for (const key of EXPORT_TABLE_KEYS) expect(isExportTableKey(key)).toBe(true);
    expect(isExportTableKey("unit-finance")).toBe(false);
    expect(isExportTableKey("../../etc/passwd")).toBe(false);
    expect(isExportTableKey("")).toBe(false);
  });

  it("every export table key has a report title and a filename label - never falls through to a raw key string", () => {
    for (const key of EXPORT_TABLE_KEYS) {
      expect(EXPORT_TABLE_TITLES[key]).toBeTruthy();
      expect(EXPORT_FILENAME_LABELS[key]).toBeTruthy();
    }
  });
});

describe("buildUnitBlockTable - 單位別費用與編制 raw rows", () => {
  const adminBlock = UNIT_BLOCKS.find((b) => b.key === "admin")!;

  it("shows 財務管理處's real figures only when its version is in the selected scope", () => {
    const v = makeFinanceVersion("DRAFT");
    const table = buildUnitBlockTable(adminBlock, DEMO_DEPARTMENT_NAME, v, "draft_included", formatDate);
    const financeRow = table.rows.find((r) => textOf(r.cells[0]) === DEMO_DEPARTMENT_NAME)!;
    // cells: [部門, 人數, 費用金額, 編制人數, 預算金額, 新員預算, 合計, 增減金額, 成長率, 狀態, 最後編製日期]
    expect(financeRow.cells[1]).toMatchObject({ kind: "count", value: 10 });
    expect(textOf(financeRow.cells[9])).toBe("草稿");
  });

  it("財務管理處 gets a distinct status (not the generic 未編製) when its version is filtered out by scope", () => {
    const v = makeFinanceVersion("DRAFT");
    const table = buildUnitBlockTable(adminBlock, DEMO_DEPARTMENT_NAME, v, "submitted", formatDate);
    const financeRow = table.rows.find((r) => textOf(r.cells[0]) === DEMO_DEPARTMENT_NAME)!;
    const statusText = textOf(financeRow.cells[9]);
    expect(statusText).not.toBe("未編製");
    expect(statusText).not.toBe(TARGET_YEAR_NOT_PREPARED_LABEL);
    // amount cells must still be null (never a fabricated figure), even though a version exists
    expect(financeRow.cells[2]).toMatchObject({ kind: "amount", value: null });
  });

  it("財務管理處 shows the distinct '尚未編製' label when no fiscalYear=2027 version exists at all", () => {
    const table = buildUnitBlockTable(adminBlock, DEMO_DEPARTMENT_NAME, null, "draft_included", formatDate);
    const financeRow = table.rows.find((r) => textOf(r.cells[0]) === DEMO_DEPARTMENT_NAME)!;
    expect(textOf(financeRow.cells[9])).toBe(TARGET_YEAR_NOT_PREPARED_LABEL);
  });

  it("every representative-only department row is entirely null/dash amounts - never a fabricated 0", () => {
    const table = buildUnitBlockTable(adminBlock, DEMO_DEPARTMENT_NAME, null, "draft_included", formatDate);
    const otherRows = table.rows.filter((r) => {
      const name = textOf(r.cells[0]);
      return name !== DEMO_DEPARTMENT_NAME && !name.includes("體系小計");
    });
    expect(otherRows.length).toBeGreaterThan(0);
    for (const row of otherRows) {
      expect(row.cells[1]).toMatchObject({ kind: "count", value: null });
      expect(row.cells[2]).toMatchObject({ kind: "amount", value: null });
      expect(textOf(row.cells[9])).toBe("未編製");
    }
  });

  it("每個 UNIT_BLOCKS 區塊都能建出正確的表頭與體系小計列", () => {
    for (const block of UNIT_BLOCKS) {
      const table = buildUnitBlockTable(block, DEMO_DEPARTMENT_NAME, null, "draft_included", formatDate);
      expect(table.headerLabels).toHaveLength(11);
      const lastRow = table.rows[table.rows.length - 1];
      expect(lastRow?.style).toBe("subtotal");
    }
  });
});

describe("buildSgaTable / buildProductionTable - 管銷研排除生產，生產排除管銷研", () => {
  it("生產科目彙總 is entirely static placeholder rows, independent of any finance data", () => {
    const table = buildProductionTable();
    expect(table.rows.length).toBeGreaterThan(0);
    for (const row of table.rows) {
      for (const c of row.cells) {
        if (c.kind === "text") continue;
        expect(c.value).toBeNull();
      }
    }
  });

  it("管銷研科目彙總 rows never include a 生產-specific placeholder label, and vice versa", () => {
    const v = makeFinanceVersion("DRAFT");
    const sga = buildSgaTable(v, "draft_included");
    const sgaLabels = sga.rows.map((r) => textOf(r.cells[1]));
    // 生產費用總計/直接人員薪資/間接人員薪資 etc. are production-only placeholder rows (PRODUCTION_PLACEHOLDER_ROWS).
    expect(sgaLabels).not.toContain("生產費用總計");
    expect(sgaLabels).not.toContain("直接人員薪資");
    expect(sgaLabels).not.toContain("間接人員薪資");

    const production = buildProductionTable();
    const productionLabels = production.rows.map((r) => textOf(r.cells[1]));
    // The 62 real SGA account names (from the finance department's actual BudgetLine data) must never leak into the still-fully-placeholder production table.
    expect(productionLabels).not.toContain("薪資支出");
    expect(productionLabels).not.toContain("交通費");
  });

  it("管銷研科目彙總 is empty (no fabricated rows) when 財務管理處 has no in-scope 2027 data", () => {
    const table = buildSgaTable(null, "draft_included");
    expect(table.rows).toHaveLength(0);
  });
});

describe("buildCompanySummaryTable - 全公司費用合計", () => {
  it("always has exactly 3 rows (管銷研合計/生產合計/全公司總計) regardless of data availability", () => {
    const withData = buildCompanySummaryTable(makeFinanceVersion("DRAFT"), "draft_included");
    const withoutData = buildCompanySummaryTable(null, "draft_included");
    expect(withData.rows).toHaveLength(3);
    expect(withoutData.rows).toHaveLength(3);
    expect(withData.rows[2]?.style).toBe("total");
    expect(withoutData.rows[2]?.style).toBe("total");
  });
});

describe("buildReportMeta / provisionalNoteIfIncomplete", () => {
  it("labels every report as provisional in Stage 1 (only 財務管理處 can ever have real data)", () => {
    const meta = buildReportMeta("company", null, "draft_included", "2026-09-08T00:00:00.000Z", formatDate);
    expect(provisionalNoteIfIncomplete(meta)).toBeTruthy();
  });

  it("asOfLabel falls back to '尚無資料' when there is no in-scope version", () => {
    const meta = buildReportMeta("company", null, "draft_included", "2026-09-08T00:00:00.000Z", formatDate);
    expect(meta.asOfLabel).toBe("尚無資料");
  });
});

describe("sanitizeCellText - formula-injection guard used by the Excel export", () => {
  it("still prefixes a leading apostrophe for =/+/-/@ (regression guard, real coverage lives in excel.test.ts)", () => {
    expect(sanitizeCellText("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(sanitizeCellText("正常部門名稱")).toBe("正常部門名稱");
  });
});
