import { Decimal } from "@/lib/money/decimal";

/**
 * Presentation-only formatting helpers for the budget summary preview
 * (`/dashboard/reports/budget-summary-preview`). Pure functions, no React/
 * DOM/Prisma - safe to unit test directly and to share between the server
 * page and the client component.
 *
 * Formatting rules (per the reference spreadsheets):
 *  - "尚未編製"/missing figures render as "—", never "0" - a department
 *    with no data is not the same as a department that budgeted zero.
 *  - Positive amounts use a thousands separator ("1,200,000").
 *  - Negative amounts use red parentheses, no minus sign ("(5,753,051)") -
 *    the same convention applied to a negative growth rate.
 *  - Growth rates are shown to one decimal place ("3.4%") or "—" when not
 *    computable (division by a zero base).
 */

export interface FormattedCell {
  text: string;
  /** true when the underlying value is negative - callers apply the red text color class themselves. */
  negative: boolean;
}

const DASH = "—";

function toDisplayDecimal(value: Decimal.Value | number | null | undefined): Decimal | null {
  if (value === null || value === undefined) return null;
  return value instanceof Decimal ? value : new Decimal(value);
}

/** Whole-number money amount ("1,200,000" / "(5,753,051)" / "—"). */
export function formatAmountCell(value: Decimal.Value | number | null | undefined): FormattedCell {
  const d = toDisplayDecimal(value);
  if (d === null) return { text: DASH, negative: false };
  const rounded = d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const abs = Number(rounded.abs().toString()).toLocaleString("zh-TW");
  const negative = rounded.isNegative();
  return { text: negative ? `(${abs})` : abs, negative };
}

/** Plain integer count ("10" / "—") - headcount, never a fraction. */
export function formatCountCell(value: number | null | undefined): FormattedCell {
  if (value === null || value === undefined) return { text: DASH, negative: false };
  const negative = value < 0;
  return { text: negative ? `(${Math.abs(value).toLocaleString("zh-TW")})` : value.toLocaleString("zh-TW"), negative };
}

/** Growth rate as a fraction (0.034 = 3.4%) -> "3.4%" / "(3.4%)" / "—" when null (undefined base). */
export function formatGrowthRateCell(value: Decimal.Value | number | null | undefined): FormattedCell {
  const d = toDisplayDecimal(value);
  if (d === null) return { text: DASH, negative: false };
  const pct = d.times(100);
  const abs = pct.abs().toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toString();
  const negative = pct.isNegative();
  return { text: negative ? `(${abs}%)` : `${abs}%`, negative };
}
