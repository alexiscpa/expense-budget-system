# Stage 2B-1 department reconciliation tools

Read-only tooling used to build `docs/stage2b1-department-reconciliation.md`
and `docs/data/stage2b1-department-manifest.{json,csv}` from the source
workbook `2025費用總表-第一版(20241122).xlsx`.

The source workbook itself (external business data, ~7MB) is **not**
committed to this repo. To regenerate the evidence from scratch, obtain a
local copy of that file and run:

```sh
node scripts/stage2b1/dump-workbook.js /path/to/2025費用總表-第一版(20241122).xlsx /tmp/stage2b1-dump
node scripts/stage2b1/crossref-departments.js /tmp/stage2b1-dump /tmp/stage2b1-dump
```

`dump-workbook.js` exports every sheet's cells (value or formula string +
last-cached Excel result) to one JSON file per sheet, plus a
`_manifest.json` index. `crossref-departments.js` reads that dump and
produces:

- `erp_departments.json` - the ERP部門 sheet's own 68-row department list.
- `occurrences.json` - every place each department code appears anywhere
  in the workbook (bare cell value, slash-merged code group, or formula
  string mention).
- `self_declared.json` - for every 銷-/管-/研-/生- prefixed detail sheet,
  the department code that sheet's own row-3 `VLOOKUP(C3, ERP部門!A:B, 2,
  FALSE)` formula resolves to - the strongest evidence type used
  throughout the reconciliation report.

Both scripts are pure, offline readers: they never write to the source
`.xlsx`, never touch a database, and never call any part of this
application. See `docs/stage2b1-department-reconciliation.md` §10 for the
full no-write-access statement.
