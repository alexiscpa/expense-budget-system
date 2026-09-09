import { describe, it, expect } from "vitest";
import {
  buildMultiDeptUnitBlockTable,
  buildMultiDeptReportingTables,
  buildMultiDeptCompanySummaryTable,
  buildMultiDeptReportMeta,
  computeReportingGrandAgg,
  completenessSummaryLine,
} from "@/lib/reports/multiDeptExportTables";
import type { DeptVersionDto, DeptLineDto, DeptSummaryEntry } from "@/lib/reports/multiDepartmentSummary";
import { isSgaClass, isProductionClass, buildScopeCompleteness } from "@/lib/reports/multiDepartmentSummary";
import { SGA_REPORTING_ACCOUNTS } from "@/lib/reports/reportingAccountMap";
import { TARGET_YEAR_NOT_PREPARED_LABEL, type UnitBlock } from "@/lib/reports/budgetSummaryPreviewData";
import type { RawCell } from "@/lib/reports/summaryReportData";

const T0 = "2026-01-01T00:00:00.000Z";
const T1 = "2026-01-02T00:00:00.000Z";

function line(overrides: Partial<DeptLineDto> = {}): DeptLineDto {
  return {
    id: "line-1",
    priorYearOriginalBudget: "1000000",
    nextYearTargetExcludingNew: "0",
    nextYearNewHireBudget: "0",
    nextYearTotal: "0",
    createdAt: T0,
    updatedAt: T0,
    account: { code: "6210010", name: "薪資支出", commonCategory: "PERSONNEL" },
    ...overrides,
  };
}

function version(overrides: Partial<DeptVersionDto> = {}): DeptVersionDto {
  return {
    id: "ver-1",
    status: "DRAFT",
    priorYearHeadcount: 8,
    budgetYearHeadcount: 8,
    lastPreparedAt: T0,
    createdAt: T0,
    lines: [line()],
    ...overrides,
  };
}

function entry(overrides: Partial<DeptSummaryEntry> = {}): DeptSummaryEntry {
  return {
    code: "12111",
    name: "台北",
    class: "S",
    isTestData: true,
    version: version(),
    ...overrides,
  };
}

function textOf(cell: RawCell | undefined): string {
  if (!cell || cell.kind !== "text") throw new Error(`expected a text cell, got ${JSON.stringify(cell)}`);
  return cell.value;
}

const TEST_BLOCK: UnitBlock = {
  key: "sales",
  title: "二、營業單位（包含海外單位）",
  departments: [
    { name: "台北", code: "12111" },
    { name: "無代碼部門" }, // pure representative placeholder, no real Department at all
  ],
};

describe("buildMultiDeptUnitBlockTable - real per-department rows from deptEntries", () => {
  it("shows a real row (headcount/amount/status/date) for a department with a version", () => {
    const deptEntries = [entry()];
    const table = buildMultiDeptUnitBlockTable(TEST_BLOCK, deptEntries);
    const row = table.rows[0]!;
    expect(row.cells[1]).toMatchObject({ kind: "count", value: 8 });
    expect(row.cells[2]).toMatchObject({ kind: "amount" });
    expect((row.cells[2] as { value: { toNumber(): number } }).value.toNumber()).toBe(1000000);
    expect(textOf(row.cells[9])).toBe("草稿");
    expect(row.cells[10]!.kind).toBe("date");
  });

  it("2027 columns are null (—) until the department's own version has been touched, even though it has a real version", () => {
    const deptEntries = [entry()]; // lastPreparedAt === createdAt -> untouched
    const table = buildMultiDeptUnitBlockTable(TEST_BLOCK, deptEntries);
    const row = table.rows[0]!;
    expect(row.cells[4]).toMatchObject({ kind: "amount", value: null }); // 預算金額 (excludingNew)
    expect(row.cells[6]).toMatchObject({ kind: "amount", value: null }); // 合計
  });

  it("shows the real amount once the version has been touched, including an explicit 0", () => {
    const deptEntries = [
      entry({
        version: version({
          lastPreparedAt: T1,
          lines: [line({ updatedAt: T1, nextYearTargetExcludingNew: "500000", nextYearTotal: "500000" })],
        }),
      }),
    ];
    const table = buildMultiDeptUnitBlockTable(TEST_BLOCK, deptEntries);
    const row = table.rows[0]!;
    expect((row.cells[4] as { value: { toNumber(): number } }).value.toNumber()).toBe(500000);
  });

  it("a code-addressable department with no version at all shows the distinct '尚未編製' label, not a fabricated amount", () => {
    const table = buildMultiDeptUnitBlockTable(TEST_BLOCK, []);
    const row = table.rows[0]!;
    expect(textOf(row.cells[9])).toBe(TARGET_YEAR_NOT_PREPARED_LABEL);
    expect(row.cells[2]).toMatchObject({ kind: "amount", value: null });
  });

  it("a pure representative placeholder (no code at all) shows the generic '未編製', never TARGET_YEAR_NOT_PREPARED_LABEL", () => {
    const table = buildMultiDeptUnitBlockTable(TEST_BLOCK, []);
    const placeholderRow = table.rows[1]!;
    expect(textOf(placeholderRow.cells[0])).toBe("無代碼部門");
    expect(textOf(placeholderRow.cells[9])).toBe("未編製");
  });

  it("every existing version is shown regardless of its status (matches the web's own UnitTab, which never filters by dataScope either)", () => {
    const deptEntries = [entry({ version: version({ status: "SUBMITTED" }) })];
    const table = buildMultiDeptUnitBlockTable(TEST_BLOCK, deptEntries);
    const row = table.rows[0]!;
    expect(textOf(row.cells[9])).toBe("已送出");
    expect(row.cells[2]).toMatchObject({ kind: "amount" });
  });

  it("the test-data badge appears in the department name cell for a Stage 2A department", () => {
    const table = buildMultiDeptUnitBlockTable(TEST_BLOCK, [entry({ isTestData: true })]);
    expect(textOf(table.rows[0]!.cells[0])).toContain("【測試資料】");
  });

  it("the subtotal row pools every department's lines and headcounts, ignoring the placeholder", () => {
    const deptEntries = [
      entry({
        code: "12111",
        version: version({
          priorYearHeadcount: 8,
          budgetYearHeadcount: 8,
          lastPreparedAt: T1,
          lines: [line({ priorYearOriginalBudget: "100", updatedAt: T1, nextYearTargetExcludingNew: "50", nextYearTotal: "50" })],
        }),
      }),
    ];
    const table = buildMultiDeptUnitBlockTable(TEST_BLOCK, deptEntries);
    const subtotal = table.rows[table.rows.length - 1]!;
    expect(subtotal.style).toBe("subtotal");
    expect((subtotal.cells[1] as { value: number }).value).toBe(8);
    expect((subtotal.cells[2] as { value: { toNumber(): number } }).value.toNumber()).toBe(100);
    expect((subtotal.cells[4] as { value: { toNumber(): number } }).value.toNumber()).toBe(50);
  });

  it("an empty block (no departments at all) still produces a subtotal row of all dashes, not a crash", () => {
    const table = buildMultiDeptUnitBlockTable(TEST_BLOCK, []);
    const subtotal = table.rows[table.rows.length - 1]!;
    expect(subtotal.style).toBe("subtotal");
    expect(subtotal.cells[1]).toMatchObject({ kind: "count", value: null });
  });
});

describe("buildMultiDeptReportingTables - 科目彙總 (no department column) + 部門總覽", () => {
  const salaryMapping = SGA_REPORTING_ACCOUNTS.find((m) => m.sourceCodes.S === "6210010")!;

  it("overview table lists only departments with a version - never the ones with none", () => {
    const deptEntries = [entry({ code: "a", class: "S" }), entry({ code: "b", class: "S", version: null })];
    const tables = buildMultiDeptReportingTables(deptEntries, isSgaClass, [salaryMapping], "管銷研費用總計");
    expect(tables.overview.rows).toHaveLength(1);
  });

  it("accounts table's total row equals computeReportingGrandAgg's own pooled sum - one calculation, not two", () => {
    const deptEntries = [
      entry({ code: "a", class: "S", version: version({ lines: [line({ priorYearOriginalBudget: "100" })] }) }),
      entry({ code: "b", class: "S", version: version({ lines: [line({ priorYearOriginalBudget: "200" })] }) }),
    ];
    const tables = buildMultiDeptReportingTables(deptEntries, isSgaClass, [salaryMapping], "管銷研費用總計");
    const grandAgg = computeReportingGrandAgg(deptEntries, isSgaClass, [salaryMapping]);
    expect(tables.grandAgg.prior.toNumber()).toBe(grandAgg.prior.toNumber());
    expect(tables.grandAgg.prior.toNumber()).toBe(300);

    const totalRow = tables.accounts.rows[1]!; // [0]=部門人數, [1]=total, [2+]=per-mapping
    expect(textOf(totalRow.cells[2])).toBe("管銷研費用總計");
    expect((totalRow.cells[3] as { value: { toNumber(): number } }).value.toNumber()).toBe(300);
  });

  it("a class-filtered-out department contributes nothing to the accounts table", () => {
    const deptEntries = [entry({ code: "a", class: "P", version: version({ lines: [line({ priorYearOriginalBudget: "999" })] }) })];
    const tables = buildMultiDeptReportingTables(deptEntries, isSgaClass, [salaryMapping], "管銷研費用總計");
    expect(tables.grandAgg.prior.toNumber()).toBe(0);
    expect(tables.overview.rows).toHaveLength(0);
  });

  it("unmapped rows: an account code absent from the mapping table is listed under unmapped, never silently pooled into a same-named row", () => {
    const deptEntries = [
      entry({
        code: "a",
        class: "S",
        version: version({ lines: [line({ account: { code: "UNMAPPED-1", name: "薪資支出", commonCategory: "PERSONNEL" }, priorYearOriginalBudget: "999" })] }),
      }),
    ];
    const tables = buildMultiDeptReportingTables(deptEntries, isSgaClass, [salaryMapping], "管銷研費用總計");
    expect(tables.grandAgg.prior.toNumber()).toBe(0); // the unmapped line never leaks into the real 薪資支出 aggregate
    expect(tables.unmapped).not.toBeNull();
    expect(tables.unmapped!.rows).toHaveLength(1);
  });

  it("unmapped is null (not an empty table) when every account code is mapped", () => {
    const deptEntries = [entry({ code: "a", class: "S" })]; // uses the default 6210010, which IS mapped
    const tables = buildMultiDeptReportingTables(deptEntries, isSgaClass, [salaryMapping], "管銷研費用總計");
    expect(tables.unmapped).toBeNull();
  });
});

describe("buildMultiDeptCompanySummaryTable - 全公司費用合計 recomputed from the same pooled aggregates as the SGA/生產 sheets", () => {
  it("全公司總計 = SGA合計 + 生產合計 once both scopes have real 2027 input", () => {
    const deptEntries = [
      entry({
        code: "a",
        class: "S",
        version: version({ lastPreparedAt: T1, lines: [line({ priorYearOriginalBudget: "100", updatedAt: T1, nextYearTotal: "50" })] }),
      }),
      entry({
        code: "b",
        class: "P",
        version: version({
          lastPreparedAt: T1,
          lines: [line({ account: { code: "5310010", name: "生產薪資", commonCategory: "PERSONNEL" }, priorYearOriginalBudget: "200", updatedAt: T1, nextYearTotal: "80" })],
        }),
      }),
    ];
    const table = buildMultiDeptCompanySummaryTable(deptEntries);
    const [sgaRow, prodRow, grandRow] = table.rows;
    expect((sgaRow!.cells[1] as { value: { toNumber(): number } }).value.toNumber()).toBe(100);
    expect((prodRow!.cells[1] as { value: { toNumber(): number } }).value.toNumber()).toBe(200);
    expect((grandRow!.cells[1] as { value: { toNumber(): number } }).value.toNumber()).toBe(300);
  });

  it("全公司總計's 2027 columns stay null (—) whenever either scope has no 2027 input yet - never a partial fabricated sum", () => {
    const deptEntries = [entry({ code: "a", class: "S" })]; // untouched, 2027 null
    const table = buildMultiDeptCompanySummaryTable(deptEntries);
    const grandRow = table.rows[2]!;
    expect(grandRow.cells[4]).toMatchObject({ kind: "amount", value: null }); // 2027合計
  });
});

describe("buildMultiDeptReportMeta / completenessSummaryLine", () => {
  const formatDate = (iso: string) => iso.slice(0, 10);

  it("isProvisional is true whenever any expected department has not been prepared", () => {
    const meta = buildMultiDeptReportMeta("unit-all", [entry({ version: null })], "draft_included", "2026-09-09T00:00:00.000Z", formatDate);
    expect(meta.isProvisional).toBe(true);
  });

  it("asOfLabel falls back to '尚無資料' when nothing has a version yet", () => {
    const meta = buildMultiDeptReportMeta("unit-all", [entry({ version: null })], "draft_included", "2026-09-09T00:00:00.000Z", formatDate);
    expect(meta.asOfLabel).toBe("尚無資料");
  });

  it("scopeLabel reflects the selected 資料範圍 - display only, never filters a department out", () => {
    const meta = buildMultiDeptReportMeta("unit-all", [entry()], "submitted", "2026-09-09T00:00:00.000Z", formatDate);
    expect(meta.scopeLabel).toBe("僅已送出");
  });

  it("completenessSummaryLine reports every bucket by name", () => {
    const completeness = buildScopeCompleteness([entry({ version: null })]);
    const line = completenessSummaryLine(completeness, formatDate);
    expect(line).toContain("應編部門數：1");
    expect(line).toContain("尚未編製部門數：1");
  });
});

describe("class filters reused verbatim (never reimplemented) - isSgaClass / isProductionClass", () => {
  it("still disjoint", () => {
    expect(isSgaClass("P")).toBe(false);
    expect(isProductionClass("P")).toBe(true);
  });
});
