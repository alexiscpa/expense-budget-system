import { Decimal } from "decimal.js";

// All financial arithmetic in this system MUST go through this module (or
// Prisma.Decimal directly) instead of native JS numbers, which cannot
// represent decimal currency amounts exactly (e.g. 0.1 + 0.2 !== 0.3).
Decimal.set({ precision: 28, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export const ZERO = new Decimal(0);

export function toDecimal(value: Decimal.Value | null | undefined): Decimal {
  if (value === null || value === undefined) return ZERO;
  return new Decimal(value);
}

export function sumDecimals(values: Array<Decimal.Value | null | undefined>): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.plus(toDecimal(v)), new Decimal(0));
}

/** Rounds to 2 decimal places using half-up rounding, the convention for currency amounts. */
export function roundCurrency(value: Decimal.Value): Decimal {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/**
 * Growth rate = (current - base) / base, expressed as a decimal fraction
 * (e.g. 0.1234 = 12.34%). Returns null when the base is zero, since growth
 * rate is undefined in that case (must not divide by zero or fake a value).
 */
export function growthRate(base: Decimal.Value, current: Decimal.Value): Decimal | null {
  const baseDecimal = new Decimal(base);
  if (baseDecimal.isZero()) return null;
  return new Decimal(current).minus(baseDecimal).dividedBy(baseDecimal).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
}

export function isNegative(value: Decimal.Value): boolean {
  return new Decimal(value).isNegative();
}
