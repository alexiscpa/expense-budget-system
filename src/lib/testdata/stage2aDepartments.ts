// 8 representative test departments for Stage 2A, selected from the real
// department list in 2025費用總表-第一版(20241122).xlsx sheets 'ERP部門' and
// '部門類別代碼' (codes/names verbatim from that file; none are marked
// 停用/無/已合併 there). Two per class (M/S/R/P), one of the two S
// departments is the overseas site GWK, reclassified S per explicit
// instruction for this stage (see the Stage 2A completion report - the
// other overseas codes in the source file remain "待確認" and are untouched
// by this list). 財務管理處 (17203) is deliberately excluded so this seed
// never touches the existing manual demo data for that department.
export interface Stage2aDepartmentSeed {
  code: string;
  name: string;
  class: "M" | "S" | "R" | "P";
  isOverseas: boolean;
}

export const STAGE2A_DEPARTMENTS: Stage2aDepartmentSeed[] = [
  { code: "17103", name: "資訊處", class: "M", isOverseas: false },
  { code: "17303", name: "行政管理處", class: "M", isOverseas: false },
  { code: "12111", name: "台北", class: "S", isOverseas: false },
  { code: "20001", name: "GWK", class: "S", isOverseas: true },
  { code: "11122", name: "電源研發部", class: "R", isOverseas: false },
  { code: "11322", name: "研發一部", class: "R", isOverseas: false },
  { code: "16124", name: "生產部", class: "P", isOverseas: false },
  { code: "16204", name: "台灣廠品保處", class: "P", isOverseas: false },
];
