/**
 * Excel/CSV formula-injection prevention. A string starting with one of
 * these characters is interpreted as a formula by Excel/Sheets/LibreOffice
 * when the file is opened, which is a known injection vector (CWE-1236) for
 * both imported files (a malicious upload) and exported reports (a
 * malicious department name/note round-tripping back out as a formula).
 */
const DANGEROUS_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

export function sanitizeCellText(value: string): string {
  if (value.length === 0) return value;
  if (DANGEROUS_PREFIXES.some((p) => value.startsWith(p))) {
    return `'${value}`;
  }
  return value;
}

/** Rejects a cell that Excel would treat as a live formula rather than a literal value. */
export function isFormulaCell(cellValue: unknown): boolean {
  return (
    typeof cellValue === "object" &&
    cellValue !== null &&
    ("formula" in cellValue || "sharedFormula" in cellValue)
  );
}
