import { describe, it, expect } from "vitest";
import {
  buildDeptAgg,
  buildLineAgg,
  buildReportingAccountAgg,
  buildUnmappedAccountRows,
  buildScopeCompleteness,
  lineIsTouched,
  versionHasBudgetInput,
  isSgaClass,
  isProductionClass,
  type DeptVersionDto,
  type DeptLineDto,
  type DeptSummaryEntry,
} from "@/lib/reports/multiDepartmentSummary";
import { SGA_REPORTING_ACCOUNTS } from "@/lib/reports/reportingAccountMap";

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
    account: { code: "6110010", name: "薪資支出", commonCategory: "PERSONNEL" },
    ...overrides,
  };
}

function version(overrides: Partial<DeptVersionDto> = {}): DeptVersionDto {
  return {
    id: "ver-1",
    status: "DRAFT",
    priorYearHeadcount: 10,
    budgetYearHeadcount: 10,
    lastPreparedAt: T0,
    createdAt: T0,
    lines: [line()],
    ...overrides,
  };
}

function entry(overrides: Partial<DeptSummaryEntry> = {}): DeptSummaryEntry {
  return {
    code: "17103",
    name: "資訊處",
    class: "M",
    isTestData: true,
    version: version(),
    ...overrides,
  };
}

// 薪資支出's real mapping row (M=6110010 / S=6210010 / R=6310010).
const SALARY_MAPPING = SGA_REPORTING_ACCOUNTS.find((r) => r.sourceCodes.M === "6110010")!;

describe("lineIsTouched / versionHasBudgetInput", () => {
  it("a line whose updatedAt equals createdAt has never been entered", () => {
    expect(lineIsTouched(line())).toBe(false);
  });

  it("a line whose updatedAt differs from createdAt has been entered, even to 0", () => {
    expect(lineIsTouched(line({ updatedAt: T1, nextYearTargetExcludingNew: "0" }))).toBe(true);
  });

  it("a version whose lastPreparedAt equals createdAt has no budget input yet", () => {
    expect(versionHasBudgetInput(version())).toBe(false);
  });

  it("a version whose lastPreparedAt has moved past createdAt has real input", () => {
    expect(versionHasBudgetInput(version({ lastPreparedAt: T1 }))).toBe(true);
  });

  it("a null version has no budget input", () => {
    expect(versionHasBudgetInput(null)).toBe(false);
  });
});

describe("buildDeptAgg - 2026 always shown, 2027 is null (—) until touched", () => {
  it("returns null entirely when there is no version (未編製)", () => {
    expect(buildDeptAgg(null)).toBeNull();
  });

  it("shows the real 2026 total even when 2027 has never been entered", () => {
    const agg = buildDeptAgg(version())!;
    expect(agg.priorTotal.toNumber()).toBe(1000000);
    expect(agg.excludingNewTotal).toBeNull();
    expect(agg.newHireTotal).toBeNull();
    expect(agg.grandTotal).toBeNull();
  });

  it("shows real 2027 numbers (even an entered 0) once the version has been touched", () => {
    const v = version({
      lastPreparedAt: T1,
      lines: [line({ updatedAt: T1, nextYearTargetExcludingNew: "0", nextYearTotal: "0" })],
    });
    const agg = buildDeptAgg(v)!;
    expect(agg.excludingNewTotal?.toNumber()).toBe(0);
    expect(agg.grandTotal?.toNumber()).toBe(0);
  });

  it("shows a real non-zero 2027 total once entered", () => {
    const v = version({
      lastPreparedAt: T1,
      lines: [line({ updatedAt: T1, nextYearTargetExcludingNew: "500000", nextYearTotal: "500000" })],
    });
    const agg = buildDeptAgg(v)!;
    expect(agg.excludingNewTotal?.toNumber()).toBe(500000);
    expect(agg.grandTotal?.toNumber()).toBe(500000);
    expect(agg.delta?.toNumber()).toBe(500000 - 1000000);
  });
});

describe("buildLineAgg - per-line and pooled aggregation", () => {
  it("a single untouched line shows 2026 real, 2027 null", () => {
    const agg = buildLineAgg([line()]);
    expect(agg.prior.toNumber()).toBe(1000000);
    expect(agg.excludingNew).toBeNull();
    expect(agg.total).toBeNull();
  });

  it("a single touched line shows real 2027 figures even if 0", () => {
    const agg = buildLineAgg([line({ updatedAt: T1 })]);
    expect(agg.excludingNew?.toNumber()).toBe(0);
    expect(agg.total?.toNumber()).toBe(0);
  });

  it("pooling several departments' lines: 2027 stays — only while NONE are touched", () => {
    const lines = [
      line({ id: "a", priorYearOriginalBudget: "100" }),
      line({ id: "b", priorYearOriginalBudget: "200" }),
    ];
    const agg = buildLineAgg(lines);
    expect(agg.prior.toNumber()).toBe(300);
    expect(agg.excludingNew).toBeNull();
  });

  it("pooling several departments' lines: once ANY is touched, the group shows a real sum (untouched lines contribute their stored 0)", () => {
    const lines = [
      line({ id: "a", priorYearOriginalBudget: "100", updatedAt: T1, nextYearTargetExcludingNew: "50", nextYearTotal: "50" }),
      line({ id: "b", priorYearOriginalBudget: "200" }), // untouched, still 0 in storage
    ];
    const agg = buildLineAgg(lines);
    expect(agg.prior.toNumber()).toBe(300);
    expect(agg.excludingNew?.toNumber()).toBe(50);
    expect(agg.total?.toNumber()).toBe(50);
  });

  it("an empty line list has a real (zero) 2026 total and a null 2027", () => {
    const agg = buildLineAgg([]);
    expect(agg.prior.toNumber()).toBe(0);
    expect(agg.excludingNew).toBeNull();
  });
});

describe("isSgaClass / isProductionClass", () => {
  it("SGA (管銷研) includes 營業/管理/研發, excludes 生產", () => {
    expect(isSgaClass("S")).toBe(true);
    expect(isSgaClass("M")).toBe(true);
    expect(isSgaClass("R")).toBe(true);
    expect(isSgaClass("P")).toBe(false);
  });

  it("Production includes only 生產", () => {
    expect(isProductionClass("P")).toBe(true);
    expect(isProductionClass("S")).toBe(false);
    expect(isProductionClass("M")).toBe(false);
    expect(isProductionClass("R")).toBe(false);
  });
});

describe("buildReportingAccountAgg - one pooled row per reportingAccountKey, never per department+account", () => {
  it("merges M/S/R's three different Account.codes for the same reporting line into a single sum", () => {
    const entries = [
      entry({ code: "17103", name: "資訊處", class: "M", version: version({ lines: [line({ id: "m", account: { code: "6110010", name: "薪資支出", commonCategory: "PERSONNEL" }, priorYearOriginalBudget: "100" })] }) }),
      entry({ code: "12111", name: "台北", class: "S", version: version({ lines: [line({ id: "s", account: { code: "6210010", name: "薪資支出", commonCategory: "PERSONNEL" }, priorYearOriginalBudget: "200" })] }) }),
      entry({ code: "11122", name: "電源研發部", class: "R", version: version({ lines: [line({ id: "r", account: { code: "6310010", name: "薪資支出", commonCategory: "PERSONNEL" }, priorYearOriginalBudget: "300" })] }) }),
    ];
    const agg = buildReportingAccountAgg(entries, SALARY_MAPPING);
    expect(agg.prior.toNumber()).toBe(600); // 100 + 200 + 300, one merged row
  });

  it("a department with no version contributes nothing (never treated as a real 0)", () => {
    const entries = [entry({ version: null }), entry({ code: "12111", class: "S", version: version({ lines: [line({ priorYearOriginalBudget: "500" })] }) })];
    const agg = buildReportingAccountAgg(entries, SALARY_MAPPING);
    expect(agg.prior.toNumber()).toBe(500);
  });

  it("2027 stays null (—) until at least one pooled line has actually been touched", () => {
    const entries = [entry(), entry({ code: "12111", class: "S" })];
    const agg = buildReportingAccountAgg(entries, SALARY_MAPPING);
    expect(agg.excludingNew).toBeNull();
  });

  it("a line for a different reportingAccountKey is never pooled in", () => {
    const otherMapping = SGA_REPORTING_ACCOUNTS.find((r) => r.reportingAccountKey !== SALARY_MAPPING.reportingAccountKey)!;
    const entries = [entry()]; // only has a 6110010 (薪資支出) line
    const agg = buildReportingAccountAgg(entries, otherMapping);
    expect(agg.prior.toNumber()).toBe(0);
  });
});

describe("buildUnmappedAccountRows - 待確認科目 (no reportingAccountKey, never merged by name)", () => {
  it("an account code absent from reportingAccountMap.ts is listed, not silently merged into the 薪資支出 row it shares a name with", () => {
    const entries = [
      entry({
        code: "17203",
        name: "財務管理處",
        version: version({ lines: [line({ account: { code: "3", name: "薪資支出", commonCategory: "PERSONNEL" }, priorYearOriginalBudget: "999" })] }),
      }),
    ];
    const rows = buildUnmappedAccountRows(entries);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ departmentCode: "17203", accountCode: "3", accountName: "薪資支出" });

    const salaryAgg = buildReportingAccountAgg(entries, SALARY_MAPPING);
    expect(salaryAgg.prior.toNumber()).toBe(0); // the unmapped "3" line must not leak into the real 薪資支出 aggregate
  });

  it("a mapped account code never appears in the unmapped list", () => {
    const entries = [entry()]; // 6110010, a real mapped code
    expect(buildUnmappedAccountRows(entries)).toHaveLength(0);
  });

  it("a department with no version contributes no unmapped rows", () => {
    expect(buildUnmappedAccountRows([entry({ version: null })])).toHaveLength(0);
  });
});

describe("buildScopeCompleteness - table-level 應編/已建立草稿/已輸入/已送出/尚未編製 counts", () => {
  it("counts every bucket correctly across a mix of statuses", () => {
    const entries = [
      entry({ code: "a", version: version({ status: "DRAFT", lastPreparedAt: T0, createdAt: T0 }) }), // drafted, no input
      entry({ code: "b", version: version({ status: "DRAFT", lastPreparedAt: T1, createdAt: T0 }) }), // drafted, has input
      entry({ code: "c", version: version({ status: "SUBMITTED", lastPreparedAt: T1, createdAt: T0 }) }), // submitted
      entry({ code: "d", version: null }), // not prepared at all
    ];
    const stats = buildScopeCompleteness(entries);
    expect(stats.expectedDepartmentCount).toBe(4);
    expect(stats.draftDepartmentCount).toBe(3);
    expect(stats.inputDepartmentCount).toBe(2); // b and c
    expect(stats.submittedDepartmentCount).toBe(1); // c
    expect(stats.notPreparedDepartmentCount).toBe(1);
    expect(stats.notPreparedDepartmentNames).toEqual(["資訊處"]); // entry()'s default name, for the "d" entry
  });

  it("lastUpdatedAt is the most recent lastPreparedAt among departments that have a version, or null if none do", () => {
    const withVersions = buildScopeCompleteness([
      entry({ version: version({ lastPreparedAt: T0 }) }),
      entry({ version: version({ lastPreparedAt: T1 }) }),
    ]);
    expect(withVersions.lastUpdatedAt).toBe(T1);

    const noneYet = buildScopeCompleteness([entry({ version: null })]);
    expect(noneYet.lastUpdatedAt).toBeNull();
  });

  it("an empty scope (no departments at all) reports all-zero counts, not an error", () => {
    const stats = buildScopeCompleteness([]);
    expect(stats).toMatchObject({
      expectedDepartmentCount: 0,
      draftDepartmentCount: 0,
      inputDepartmentCount: 0,
      submittedDepartmentCount: 0,
      notPreparedDepartmentCount: 0,
      lastUpdatedAt: null,
    });
  });
});
