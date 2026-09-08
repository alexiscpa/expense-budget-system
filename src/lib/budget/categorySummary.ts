import { Decimal, sumDecimals } from "@/lib/money/decimal";
import type { AccountCommonCategory } from "@prisma/client";

/**
 * Client-safe (no Prisma runtime, no server-only import) pure aggregation.
 * Used both server-side (page.tsx, for an initial render) and client-side
 * (BudgetVersionClient.tsx, so the four category totals and the 管理費用
 * grand total stay live as the user edits amounts) - the same function
 * everywhere, so the two can never drift.
 *
 * Deliberately never reads a stored subtotal - the four category totals and
 * the grand total are always summed fresh from the detail lines passed in,
 * so they can never go stale or be hand-typed from a spreadsheet's own
 * subtotal cells.
 */

export const CATEGORY_LABELS: Record<AccountCommonCategory, string> = {
  PERSONNEL: "人事費用",
  SG_AND_A: "銷管費用",
  OFFICE: "辦公費用",
  OTHER: "其他費用",
};

// Matches the classification order given for this dataset: 薪資支出..加班費
// (人事), 交通費..出口費用－報關費 (銷管), 租金支出..ICT工程費 (辦公),
// 呆帳..其他費用－其他 (其他).
export const CATEGORY_ORDER: AccountCommonCategory[] = ["PERSONNEL", "SG_AND_A", "OFFICE", "OTHER"];

export interface CategorySummaryRow {
  category: AccountCommonCategory;
  label: string;
  total: Decimal;
}

export interface CategorySummary {
  rows: CategorySummaryRow[];
  /** 管理費用 - the sum of all four category rows, i.e. of every detail line. */
  grandTotal: Decimal;
}

export function computeCategorySummary(
  items: readonly { commonCategory: AccountCommonCategory; amount: Decimal.Value }[]
): CategorySummary {
  const rows = CATEGORY_ORDER.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    total: sumDecimals(items.filter((i) => i.commonCategory === category).map((i) => i.amount)),
  }));
  const grandTotal = sumDecimals(rows.map((r) => r.total));
  return { rows, grandTotal };
}
