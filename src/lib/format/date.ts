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
