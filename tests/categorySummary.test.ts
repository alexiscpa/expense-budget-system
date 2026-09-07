import { describe, it, expect } from "vitest";
import { computeCategorySummary, CATEGORY_ORDER } from "@/lib/budget/categorySummary";

describe("computeCategorySummary - pure, no fabricated subtotals", () => {
  it("sums each category independently and the grand total equals the sum of all items", () => {
    const items = [
      { commonCategory: "PERSONNEL" as const, amount: "100.50" },
      { commonCategory: "PERSONNEL" as const, amount: "50.25" },
      { commonCategory: "SG_AND_A" as const, amount: "10" },
      { commonCategory: "OFFICE" as const, amount: "5" },
      { commonCategory: "OTHER" as const, amount: "-2.75" },
    ];

    const { rows, grandTotal } = computeCategorySummary(items);

    const personnel = rows.find((r) => r.category === "PERSONNEL");
    expect(personnel?.total.toString()).toBe("150.75");
    expect(rows.find((r) => r.category === "SG_AND_A")?.total.toString()).toBe("10");
    expect(rows.find((r) => r.category === "OFFICE")?.total.toString()).toBe("5");
    expect(rows.find((r) => r.category === "OTHER")?.total.toString()).toBe("-2.75");
    expect(grandTotal.toString()).toBe("163");
  });

  it("returns zero (not undefined/NaN) for a category with no items", () => {
    const { rows, grandTotal } = computeCategorySummary([{ commonCategory: "PERSONNEL", amount: "1" }]);
    expect(rows.find((r) => r.category === "OTHER")?.total.toString()).toBe("0");
    expect(grandTotal.toString()).toBe("1");
  });

  it("always returns exactly the four rows in the documented category order", () => {
    const { rows } = computeCategorySummary([]);
    expect(rows.map((r) => r.category)).toEqual(CATEGORY_ORDER);
    expect(CATEGORY_ORDER).toEqual(["PERSONNEL", "SG_AND_A", "OFFICE", "OTHER"]);
  });

  it("never loses cents to floating-point error across many small amounts", () => {
    const items = Array.from({ length: 1000 }, () => ({ commonCategory: "OFFICE" as const, amount: "0.01" }));
    const { grandTotal } = computeCategorySummary(items);
    expect(grandTotal.toString()).toBe("10"); // 1000 * 0.01 exactly, not 9.999999999999998
  });
});
