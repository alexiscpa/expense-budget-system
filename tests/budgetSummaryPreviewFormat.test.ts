import { describe, it, expect } from "vitest";
import { formatAmountCell, formatCountCell, formatGrowthRateCell } from "@/lib/reports/summaryFormat";
import { UNIT_BLOCKS, OVERSEAS_UNIT_NAMES, PRODUCTION_PLACEHOLDER_ROWS } from "@/lib/reports/budgetSummaryPreviewData";
import { DEMO_DEPARTMENT_NAME, DEMO_DEPARTMENT_CODE } from "@/lib/demo/constants";

describe("budget summary preview - amount formatting", () => {
  it("formats a positive amount with thousands separators, no parens", () => {
    expect(formatAmountCell("1200000")).toEqual({ text: "1,200,000", negative: false });
    expect(formatAmountCell(7905511)).toEqual({ text: "7,905,511", negative: false });
  });

  it("formats a negative amount in red parentheses, no minus sign", () => {
    expect(formatAmountCell("-5753051")).toEqual({ text: "(5,753,051)", negative: true });
    expect(formatAmountCell(-709704)).toEqual({ text: "(709,704)", negative: true });
  });

  it("never renders a missing/未編製 amount as 0 - always a dash", () => {
    expect(formatAmountCell(null)).toEqual({ text: "—", negative: false });
    expect(formatAmountCell(undefined)).toEqual({ text: "—", negative: false });
  });

  it("zero itself (an actual, known figure) is still shown as 0, not a dash", () => {
    expect(formatAmountCell(0)).toEqual({ text: "0", negative: false });
  });
});

describe("budget summary preview - headcount formatting", () => {
  it("formats a plain integer count", () => {
    expect(formatCountCell(10)).toEqual({ text: "10", negative: false });
  });

  it("未編製 headcount is a dash, never 0", () => {
    expect(formatCountCell(null)).toEqual({ text: "—", negative: false });
  });
});

describe("budget summary preview - growth rate formatting", () => {
  it("formats a positive growth rate to one decimal place", () => {
    expect(formatGrowthRateCell(0.034)).toEqual({ text: "3.4%", negative: false });
    expect(formatGrowthRateCell("0.03349")).toEqual({ text: "3.3%", negative: false }); // half-up rounding
  });

  it("formats a negative growth rate in red parentheses", () => {
    expect(formatGrowthRateCell(-0.123)).toEqual({ text: "(12.3%)", negative: true });
  });

  it("an uncomputable growth rate (null base) is a dash, never 0%", () => {
    expect(formatGrowthRateCell(null)).toEqual({ text: "—", negative: false });
  });
});

function names(departments: readonly { name: string }[]): string[] {
  return departments.map((d) => d.name);
}

describe("budget summary preview - representative department data", () => {
  it("every overseas unit name is filed under the 營業單位 (sales) block, never its own block", () => {
    const salesBlock = UNIT_BLOCKS.find((b) => b.key === "sales")!;
    const overseasNames = names(OVERSEAS_UNIT_NAMES);
    for (const overseasName of overseasNames) {
      expect(names(salesBlock.departments)).toContain(overseasName);
    }
    // And nowhere else.
    for (const block of UNIT_BLOCKS) {
      if (block.key === "sales") continue;
      for (const overseasName of overseasNames) {
        expect(names(block.departments)).not.toContain(overseasName);
      }
    }
  });

  it("生產單位 (production) block is disjoint from every 管銷研 block (rd/sales/admin)", () => {
    const productionBlock = UNIT_BLOCKS.find((b) => b.key === "production")!;
    const sgaBlocks = UNIT_BLOCKS.filter((b) => b.key !== "production");
    for (const name of names(productionBlock.departments)) {
      for (const block of sgaBlocks) {
        expect(names(block.departments)).not.toContain(name);
      }
    }
  });

  it("財務管理處 (the one real-data department) is listed under 管理單位, with its real department code", () => {
    const adminBlock = UNIT_BLOCKS.find((b) => b.key === "admin")!;
    expect(names(adminBlock.departments)).toContain(DEMO_DEPARTMENT_NAME);
    const entry = adminBlock.departments.find((d) => d.name === DEMO_DEPARTMENT_NAME);
    expect(entry?.code).toBe(DEMO_DEPARTMENT_CODE);
  });

  it("all four required blocks and their minimum representative names are present", () => {
    expect(UNIT_BLOCKS).toHaveLength(4);
    const rd = UNIT_BLOCKS.find((b) => b.key === "rd")!;
    expect(names(rd.departments)).toEqual(expect.arrayContaining(["研發一部", "研發二部", "電源研發部", "量測研發部", "研發工程部"]));
    const sales = UNIT_BLOCKS.find((b) => b.key === "sales")!;
    expect(names(sales.departments)).toEqual(
      expect.arrayContaining(["第一營業本部", "台北", "台中", "高雄", "行銷技術", "行銷支援", "系統整合"])
    );
    const admin = UNIT_BLOCKS.find((b) => b.key === "admin")!;
    expect(names(admin.departments)).toEqual(
      expect.arrayContaining(["董事長室", "稽核室", "經營企劃室", "勞安室", "資訊處", "行政管理處"])
    );
    const production = UNIT_BLOCKS.find((b) => b.key === "production")!;
    expect(names(production.departments)).toEqual(
      expect.arrayContaining(["生產部", "生技部", "資材部", "採購部", "台灣廠品保處"])
    );
  });

  it("every Stage 2A test department and 財務管理處 carries its real code in UNIT_BLOCKS", () => {
    const expectedCodes: Record<string, string> = {
      資訊處: "17103",
      行政管理處: "17303",
      台北: "12111",
      GWK: "20001",
      電源研發部: "11122",
      研發一部: "11322",
      生產部: "16124",
      台灣廠品保處: "16204",
      [DEMO_DEPARTMENT_NAME]: DEMO_DEPARTMENT_CODE,
    };
    const allDepartments = UNIT_BLOCKS.flatMap((b) => b.departments);
    for (const [name, code] of Object.entries(expectedCodes)) {
      const entry = allDepartments.find((d) => d.name === name);
      expect(entry?.code).toBe(code);
    }
  });

  it("production tab row labels include every required placeholder row, none fabricated with a value", () => {
    const labels = PRODUCTION_PLACEHOLDER_ROWS.map((r) => r.label);
    expect(labels).toEqual(
      expect.arrayContaining([
        "平均人數",
        "生產費用",
        "間接人員薪資",
        "直接人員薪資",
        "其他生產科目",
        "人事費用小計",
        "辦公費用小計",
        "銷管費用小計",
        "其他費用小計",
        "生產費用總計",
      ])
    );
  });
});
