// Display-only name lookup for the roll-up parent codes referenced by
// Department.rollupParentCode (see schema.prisma doc comment for why this
// is a plain string, not a foreign key: every one of these parent codes is
// PARENT_ONLY per docs/data/stage2b1-department-manifest.json and therefore
// never has a Department row of its own). Generated verbatim from that
// manifest - not guessed from the code.
export const ROLLUP_PARENT_NAMES: Record<string, string> = {
  "11002": "研發事業本部",
  "11102": "電源研發事業處",
  "11202": "量測研發事業處",
  "11302": "通用儀器研發事業處",
  "12101": "台灣營業處",
  "12201": "行銷拓展處",
  "12301": "海外營業處",
  "12401": "營業企劃處",
  "13101": "南亞暨ODM營業處",
  "13201": "安防事業處",
  "15001": "台灣特販本部",
  "16004": "生產本部",
  "16104": "台灣廠",
  "17003": "管理本部",
};

export function getRollupParentName(code: string | null): string | null {
  if (!code) return null;
  return ROLLUP_PARENT_NAMES[code] ?? null;
}
