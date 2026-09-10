#!/usr/bin/env node
/**
 * Stage 2B-1 department reconciliation - read-only workbook dumper.
 *
 * Dumps every sheet of a given .xlsx workbook to one JSON file per sheet
 * (cell value or {f: formula, r: last-cached-result} / {sf: sharedFormula,
 * r: result} for formula cells), plus a _manifest.json listing every sheet
 * name/id/row-count/column-count. Never writes to the source file, never
 * touches any database - this is a pure, offline read of a local .xlsx
 * copy, used to build docs/stage2b1-department-reconciliation.md's
 * evidence trail.
 *
 * The source workbook itself (2025費用總表-第一版(20241122).xlsx, ~7MB of
 * external business data) is deliberately NOT committed to this repo -
 * only this tool and its output (docs/data/stage2b1-department-manifest.*)
 * are. To regenerate the dump from the real file:
 *
 *   node scripts/stage2b1/dump-workbook.js /path/to/2025費用總表-第一版(20241122).xlsx ./out-dir
 */
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");

function cellDump(cell) {
  const v = cell.value;
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    if (v instanceof Date) return v.toISOString();
    if ("formula" in v) return { f: v.formula, r: v.result !== undefined ? v.result : null };
    if ("sharedFormula" in v) return { sf: v.sharedFormula, r: v.result !== undefined ? v.result : null };
    if ("richText" in v) return v.richText.map((r) => r.text).join("");
    if ("error" in v) return { error: v.error };
    return v;
  }
  return v;
}

async function main() {
  const [, , srcArg, outArg] = process.argv;
  if (!srcArg) {
    console.error("Usage: node dump-workbook.js <path-to-xlsx> [out-dir]");
    process.exit(1);
  }
  const OUT = outArg || path.join(process.cwd(), "stage2b1-dump");
  fs.mkdirSync(OUT, { recursive: true });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(srcArg);

  const manifest = [];
  wb.eachSheet((sheet, id) => manifest.push({ id, name: sheet.name, rowCount: sheet.rowCount, colCount: sheet.columnCount, state: sheet.state }));
  fs.writeFileSync(path.join(OUT, "_manifest.json"), JSON.stringify(manifest, null, 2));
  console.log("Sheets:", manifest.length);

  for (const sheet of wb.worksheets) {
    const rows = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const cells = {};
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const d = cellDump(cell);
        if (d !== null) cells[colNumber] = d;
      });
      if (Object.keys(cells).length > 0) rows.push({ row: rowNumber, cells });
    });
    const safeName = sheet.name.replace(/[\\/:*?"<>|]/g, "_");
    fs.writeFileSync(path.join(OUT, `${sheet.id}__${safeName}.json`), JSON.stringify(rows));
    console.log("Dumped", sheet.name, "rows:", rows.length);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
