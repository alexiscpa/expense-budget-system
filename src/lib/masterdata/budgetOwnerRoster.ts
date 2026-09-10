// The 45 authoritative budget-preparation units for Stage 2B-2, generated
// verbatim from docs/data/stage2b1-department-manifest.json filtered to
// disposition === "BUDGET_OWNER" (see
// docs/stage2b1-final-budget-owner-list.md §一 for the full evidence chain
// behind every row - detail-sheet self-declaration cells, cross-references
// into the authority summary tables, etc.). Never derived from name/code
// prefixes at runtime - this file is the single source of truth for which
// codes get a Department row and what their class/domesticOrOverseas/
// rollupParentCode values are.
//
// PARENT_ONLY/MERGED/INACTIVE/NEEDS_CONFIRMATION codes (23 of the 68 ERP
// codes, including 12501 - confirmed deactivated per
// docs/stage2b1-department-reconciliation.md v1.3) are deliberately absent:
// this system never creates a Department row for a code with no budget
// entry point, so "not in this list" already means "no budget input, not
// counted in the progress denominator" without any extra flag to check.
import type { DeptClass, DomesticOverseas } from "@prisma/client";

export interface BudgetOwnerRosterEntry {
  code: string;
  name: string;
  class: DeptClass;
  domesticOrOverseas: DomesticOverseas;
  // ERP code of the roll-up parent this department reports under in the
  // source workbook's authority tables, or null when it lists directly
  // (see Department.rollupParentCode doc comment in schema.prisma). Purely
  // for read-side aggregation/display - see departmentRollups.ts for the
  // accompanying code -> name lookup.
  rollupParentCode: string | null;
}

export const BUDGET_OWNER_ROSTER: BudgetOwnerRosterEntry[] = [
  { code: "10003", name: "董事長室", class: "M", domesticOrOverseas: "DOMESTIC", rollupParentCode: "17003" },
  { code: "10103", name: "稽核室", class: "M", domesticOrOverseas: "DOMESTIC", rollupParentCode: "17003" },
  { code: "10203", name: "經營企劃室", class: "M", domesticOrOverseas: "DOMESTIC", rollupParentCode: "17003" },
  { code: "10303", name: "勞安室", class: "M", domesticOrOverseas: "DOMESTIC", rollupParentCode: "17003" },
  { code: "11012", name: "研發二部", class: "R", domesticOrOverseas: "DOMESTIC", rollupParentCode: "11002" },
  { code: "11022", name: "工設機構部", class: "R", domesticOrOverseas: "DOMESTIC", rollupParentCode: null },
  { code: "11122", name: "電源研發部", class: "R", domesticOrOverseas: "DOMESTIC", rollupParentCode: "11102" },
  { code: "11132", name: "電源軟體", class: "R", domesticOrOverseas: "DOMESTIC", rollupParentCode: "11102" },
  { code: "11212", name: "量測研發部", class: "R", domesticOrOverseas: "DOMESTIC", rollupParentCode: "11202" },
  { code: "11222", name: "研發工程部", class: "R", domesticOrOverseas: "DOMESTIC", rollupParentCode: null },
  { code: "11322", name: "研發一部", class: "R", domesticOrOverseas: "DOMESTIC", rollupParentCode: "11302" },
  { code: "11402", name: "事業投資發展處", class: "R", domesticOrOverseas: "DOMESTIC", rollupParentCode: null },
  { code: "12001", name: "第一營業本部", class: "S", domesticOrOverseas: "DOMESTIC", rollupParentCode: null },
  { code: "12011", name: "系統整合部", class: "S", domesticOrOverseas: "DOMESTIC", rollupParentCode: null },
  { code: "12111", name: "台北", class: "S", domesticOrOverseas: "DOMESTIC", rollupParentCode: "12101" },
  { code: "12121", name: "台中", class: "S", domesticOrOverseas: "DOMESTIC", rollupParentCode: "12101" },
  { code: "12131", name: "高雄", class: "S", domesticOrOverseas: "DOMESTIC", rollupParentCode: "12101" },
  { code: "12211", name: "行銷技術", class: "S", domesticOrOverseas: "DOMESTIC", rollupParentCode: "12201" },
  { code: "12221", name: "行銷支援部", class: "S", domesticOrOverseas: "DOMESTIC", rollupParentCode: "12201" },
  { code: "12311", name: "營業一部", class: "S", domesticOrOverseas: "OVERSEAS", rollupParentCode: "12301" },
  { code: "12321", name: "營業二部", class: "S", domesticOrOverseas: "OVERSEAS", rollupParentCode: "12301" },
  { code: "12411", name: "成品企劃部", class: "S", domesticOrOverseas: "DOMESTIC", rollupParentCode: "12401" },
  { code: "12421", name: "客戶服務部", class: "S", domesticOrOverseas: "DOMESTIC", rollupParentCode: "12401" },
  { code: "13111", name: "ODM營業部", class: "S", domesticOrOverseas: "DOMESTIC", rollupParentCode: "13101" },
  { code: "13211", name: "營業部（安防事業處）", class: "S", domesticOrOverseas: "DOMESTIC", rollupParentCode: "13201" },
  { code: "13221", name: "營業技術部（安防事業處）", class: "S", domesticOrOverseas: "DOMESTIC", rollupParentCode: "13201" },
  { code: "13231", name: "研發部（安防事業處）", class: "R", domesticOrOverseas: "DOMESTIC", rollupParentCode: "13201" },
  { code: "15011", name: "台灣特販部", class: "S", domesticOrOverseas: "DOMESTIC", rollupParentCode: "15001" },
  { code: "16114", name: "生技部", class: "P", domesticOrOverseas: "DOMESTIC", rollupParentCode: "16104" },
  { code: "16124", name: "生產部", class: "P", domesticOrOverseas: "DOMESTIC", rollupParentCode: "16104" },
  { code: "16134", name: "資材部", class: "P", domesticOrOverseas: "DOMESTIC", rollupParentCode: "16104" },
  { code: "16144", name: "採購部", class: "P", domesticOrOverseas: "DOMESTIC", rollupParentCode: "16104" },
  { code: "16204", name: "台灣廠品保處", class: "P", domesticOrOverseas: "DOMESTIC", rollupParentCode: "16004" },
  { code: "17103", name: "資訊處", class: "M", domesticOrOverseas: "DOMESTIC", rollupParentCode: "17003" },
  { code: "17203", name: "財務管理處", class: "M", domesticOrOverseas: "DOMESTIC", rollupParentCode: "17003" },
  { code: "17303", name: "行政管理處", class: "M", domesticOrOverseas: "DOMESTIC", rollupParentCode: "17003" },
  { code: "20001", name: "GWK", class: "S", domesticOrOverseas: "OVERSEAS", rollupParentCode: null },
  { code: "30001", name: "GWSEA", class: "S", domesticOrOverseas: "OVERSEAS", rollupParentCode: null },
  { code: "40001", name: "固緯上海", class: "S", domesticOrOverseas: "OVERSEAS", rollupParentCode: null },
  { code: "50001", name: "GWU", class: "S", domesticOrOverseas: "OVERSEAS", rollupParentCode: null },
  { code: "60001", name: "GWE", class: "S", domesticOrOverseas: "OVERSEAS", rollupParentCode: null },
  { code: "70001", name: "GWI", class: "S", domesticOrOverseas: "OVERSEAS", rollupParentCode: null },
  { code: "80001", name: "TEXIO", class: "S", domesticOrOverseas: "OVERSEAS", rollupParentCode: null },
  { code: "90001", name: "大陸環測事業處", class: "S", domesticOrOverseas: "OVERSEAS", rollupParentCode: null },
  { code: "A0004", name: "蘇州廠", class: "S", domesticOrOverseas: "OVERSEAS", rollupParentCode: null },
];

export const BUDGET_OWNER_ROSTER_SIZE = BUDGET_OWNER_ROSTER.length;

export function getRosterCategoryCounts(): Record<DeptClass, number> {
  const counts: Partial<Record<DeptClass, number>> = {};
  for (const entry of BUDGET_OWNER_ROSTER) {
    counts[entry.class] = (counts[entry.class] ?? 0) + 1;
  }
  return counts as Record<DeptClass, number>;
}
