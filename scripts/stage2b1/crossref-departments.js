#!/usr/bin/env node
/**
 * Stage 2B-1 department reconciliation - read-only cross-reference tool.
 *
 * Given a dump directory produced by dump-workbook.js, this:
 *  1. Reads the ERP部門 sheet's own department list (code/name/note columns).
 *  2. For every department code, finds every occurrence across every other
 *     sheet - as a bare cell value, as a slash-merged code group (e.g.
 *     "11122/11132"), or as a substring of a formula string - and reports
 *     which sheets/rows/cols mention it.
 *  3. Extracts each 銷-/管-/研-/生- prefixed detail sheet's own
 *     self-declared department code (row 3, where the sheet computes
 *     VLOOKUP(C3, ERP部門!A:B, 2, FALSE) to resolve its own department
 *     name) - the single most authoritative signal used throughout
 *     docs/stage2b1-department-reconciliation.md.
 *
 * Pure read of the JSON dump on disk; never touches a database or the
 * original .xlsx file itself.
 *
 *   node scripts/stage2b1/crossref-departments.js <dump-dir> <out-dir>
 */
const fs = require("fs");
const path = require("path");

function cellText(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("f" in v) return v.f;
    if ("sf" in v) return v.sf;
    return "";
  }
  return String(v);
}

function loadSheet(dumpDir, manifestEntry) {
  const safeName = manifestEntry.name.replace(/[\\/:*?"<>|]/g, "_");
  const file = path.join(dumpDir, `${manifestEntry.id}__${safeName}.json`);
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file));
}

function main() {
  const [, , dumpDirArg, outDirArg] = process.argv;
  if (!dumpDirArg) {
    console.error("Usage: node crossref-departments.js <dump-dir> [out-dir]");
    process.exit(1);
  }
  const dumpDir = dumpDirArg;
  const outDir = outDirArg || process.cwd();
  fs.mkdirSync(outDir, { recursive: true });

  const manifest = JSON.parse(fs.readFileSync(path.join(dumpDir, "_manifest.json")));
  const erpSheetEntry = manifest.find((m) => m.name === "ERP部門");
  if (!erpSheetEntry) throw new Error("ERP部門 sheet not found in dump manifest");
  const erpRows = loadSheet(dumpDir, erpSheetEntry);

  const depts = erpRows
    .filter((r) => r.row >= 2)
    .map((r) => ({ code: String(r.cells["1"]), name: r.cells["2"] || "", note: r.cells["3"] || null }));
  fs.writeFileSync(path.join(outDir, "erp_departments.json"), JSON.stringify(depts, null, 2));
  console.log("ERP department rows:", depts.length);

  // Occurrence scan.
  const occurrences = {};
  for (const d of depts) occurrences[d.code] = [];
  for (const sf of manifest) {
    const rows = loadSheet(dumpDir, sf);
    for (const r of rows) {
      for (const [col, val] of Object.entries(r.cells)) {
        const text = cellText(val);
        const rawVal = typeof val === "object" ? null : val;
        for (const d of depts) {
          const code = d.code;
          const bareMatch = rawVal !== null && String(rawVal) === code;
          const mergedMatch = rawVal !== null && typeof rawVal === "string" && rawVal.split("/").includes(code);
          const formulaMatch = text && text.includes(code);
          if (bareMatch || mergedMatch || formulaMatch) {
            occurrences[code].push({ sheet: sf.name, row: r.row, col, kind: bareMatch ? "bareCode" : mergedMatch ? "mergedCode" : "formulaMention" });
          }
        }
      }
    }
  }
  fs.writeFileSync(path.join(outDir, "occurrences.json"), JSON.stringify(occurrences, null, 2));

  // Self-declared department code per 銷-/管-/研-/生- detail sheet (row 3,
  // col2 === '部門', col3 = the code) - the strongest evidence type: the
  // sheet computes its own name via VLOOKUP(C3, ERP部門!A:B, 2, FALSE).
  const selfDeclared = [];
  for (const sf of manifest) {
    if (!/^(銷|管|研|生)-/.test(sf.name)) continue;
    const rows = loadSheet(dumpDir, sf);
    let found = null;
    for (const r of rows.slice(0, 6)) {
      const c2 = r.cells["2"];
      const c3 = r.cells["3"];
      if (c2 === "部門" && (typeof c3 === "number" || typeof c3 === "string")) {
        found = { row: r.row, code: c3, resolvedName: (r.cells["4"] && r.cells["4"].r) || null };
        break;
      }
    }
    selfDeclared.push({ sheet: sf.name, selfDeclared: found });
  }
  fs.writeFileSync(path.join(outDir, "self_declared.json"), JSON.stringify(selfDeclared, null, 2));

  console.log("\nSummary (non-ERP部門 occurrence count per department):");
  for (const d of depts) {
    const occ = occurrences[d.code].filter((o) => o.sheet !== "ERP部門");
    console.log(d.code, "|", d.name, "|", d.note || "", "| occurrences:", occ.length);
  }
}

main();
