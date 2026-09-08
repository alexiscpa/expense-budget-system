# Bundled PDF font

`wqy-zenhei-subset.ttf` is a glyph subset of **WenQuanYi Zen Hei**
(文泉驛正黑), an open-source CJK font that covers Traditional Chinese.

- Source: the `wqy-zenhei.ttc` TrueType Collection shipped by the
  `fonts-wqy-zenhei` package (Debian/Ubuntu), face 0 ("WenQuanYi Zen Hei
  Regular") extracted with `fontTools.ttLib.TTCollection`.
- License: dual-licensed under the GNU GPL v2 **with the font embedding
  exception** and the Arphic Public License - both explicitly permit
  embedding/redistributing the font (or a subset of it) inside another
  application without that application itself being GPL-licensed. See
  https://packages.debian.org/wenquanyi and the WenQuanYi project for the
  full license text.
- Why bundled instead of relying on system fonts: the budget summary
  preview's server-side PDF export (`lib/pdf/budgetSummaryPreviewPdf.ts`)
  must render correct Traditional Chinese glyphs in every deployment
  environment, including Vercel's Node.js serverless functions, which do
  not ship any CJK font. Embedding a real font file - rather than assuming
  one is installed - is the only way to guarantee this (Stage 1B spec §三:
  "中文字型必須正確嵌入...不得出現方框或亂碼").
- Why a subset rather than the full ~17MB collection: this Stage 1B export
  only ever renders a fixed, fully-enumerable vocabulary (hard-coded report
  labels/headers, the 62 demo account names, the hand-typed representative
  department names, and BudgetStatus labels - see
  `lib/reports/summaryReportData.ts` and `lib/reports/budgetSummaryPreviewData.ts`).
  The subset was built with `fonttools subset --text-file=<corpus of every
  distinct character used across those files>`, keeping the bundled asset
  under 250KB instead of ~17MB while still covering everything this export
  can ever need to print. If a future stage adds free-text fields (e.g. a
  真實 department import with arbitrary names, or line-item justification
  text) to what this PDF export renders, this subset must be regenerated
  against the new corpus - see the extraction command in
  `lib/pdf/budgetSummaryPreviewPdf.ts`'s file header comment.
