import { describe, it, expect } from "vitest";
import {
  buildDeptAgg,
  buildLineAgg,
  lineIsTouched,
  versionHasBudgetInput,
  isSgaClass,
  isProductionClass,
  type DeptVersionDto,
  type DeptLineDto,
} from "@/lib/reports/multiDepartmentSummary";

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
