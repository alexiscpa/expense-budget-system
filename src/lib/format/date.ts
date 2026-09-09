/**
 * Formats a UTC-stored DateTime as `YYYY.MM.DD` in the Asia/Taipei timezone
 * (UTC+8, no DST) - used for 最後一次編製日期 display everywhere it appears
 * (the budget version page and the Dashboard version list). The database
 * value itself stays a plain UTC DateTime; only the display step converts.
 */
export function formatTaipeiDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA formats as YYYY-MM-DD, which only needs its separators swapped.
  return formatter.format(date).replace(/-/g, ".");
}

/**
 * A real Excel/JS date value (never a string) representing the same
 * Asia/Taipei calendar date `formatTaipeiDate` displays for `value` - for
 * writing an actual Excel date cell (`cell.value = date; cell.numFmt =
 * "yyyy.mm.dd"`), not a pre-formatted string cell.
 *
 * ExcelJS computes the day serial from a JS Date's UTC getters, so a plain
 * `new Date(value)` would show the UTC calendar date, silently off by one
 * whenever the UTC and Taipei (UTC+8) dates differ (e.g. a timestamp just
 * after Taipei midnight but still the previous day in UTC). Building a
 * UTC-midnight Date from the already-Taipei-converted Y/M/D avoids that -
 * ExcelJS's UTC getters then read back exactly this calendar date.
 */
export function taipeiDateOnly(value: Date | string): Date {
  const date = typeof value === "string" ? new Date(value) : value;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.format(date).split("-");
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  return new Date(Date.UTC(y, m - 1, d));
}
