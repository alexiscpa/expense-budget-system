// Pure, seed-free deterministic number generation for Stage 2A test data.
// No Math.random() / Date.now() anywhere in this module - the same
// (departmentCode, accountCode) pair always yields the same numbers, so
// re-running the stress-seed (or regenerating a report) reproduces byte-
// identical output.

/** FNV-1a 32-bit hash of a string, used as the sole source of "randomness". */
function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic pseudo-random ratio in [0, 1) derived from a stable key. */
export function ratio(key: string): number {
  return hash32(key) / 0x100000000;
}

const HEADCOUNT_RANGE: Record<"M" | "S" | "R" | "P", [number, number]> = {
  M: [3, 15],
  S: [5, 25],
  R: [10, 50],
  P: [20, 100],
};

/** Deterministic 2026 projected headcount for a department, within the
 * ranges required by the Stage 2A spec (§三 rule 5). */
export function projectedHeadcount(departmentCode: string, deptClass: "M" | "S" | "R" | "P"): number {
  const [min, max] = HEADCOUNT_RANGE[deptClass];
  const r = ratio(`${departmentCode}:headcount:2026`);
  return Math.round(min + r * (max - min));
}

/** Deterministic average monthly base salary per head, TWD 40,000-70,000. */
function avgMonthlySalary(departmentCode: string): number {
  return 40000 + ratio(`${departmentCode}:avgSalary`) * 30000;
}

// Overall expense scale per class - deliberately increasing M < S ~= R < P
// so a production department's total is clearly higher than a management
// department's even before headcount (which is also larger for P) is
// factored in (Stage 2A spec §三 rule 4: "生產單位的整體金額應明顯高於一般
// 管理單位").
const CLASS_EXPENSE_SCALE: Record<"M" | "S" | "R" | "P", number> = {
  M: 1.0,
  S: 1.3,
  R: 1.5,
  P: 2.2,
};

export interface ProjectionInput {
  departmentCode: string;
  deptClass: "M" | "S" | "R" | "P";
  accountCode: string;
  accountName: string;
  commonCategory: "PERSONNEL" | "OFFICE" | "SG_AND_A" | "OTHER";
  entryType: "FORMULA" | "NOT_BUDGETED" | "DEPARTMENT_INPUT";
  headcount: number;
}

/**
 * Deterministic 2026 full-year projected amount (整數, TWD) for one
 * department/account pair. Rules (Stage 2A spec §三 rule 4):
 *  - NOT_BUDGETED accounts are always 0 (mirrors the real "不編列" rule).
 *  - Personnel-category accounts scale with headcount so they are never
 *    trivially small, and the primary "薪資/薪資支出/人工-薪資" line is
 *    always non-zero.
 *  - A deterministic ~15% slice of the remaining accounts is zeroed out to
 *    represent "不常用科目", but never the whole set and never 100% zero for
 *    a department (verified by the caller's own consistency check).
 */
export function projectedAccountAmount(input: ProjectionInput): number {
  if (input.entryType === "NOT_BUDGETED") return 0;

  const { departmentCode, deptClass, accountCode, accountName, commonCategory, headcount } = input;
  const classScale = CLASS_EXPENSE_SCALE[deptClass];
  const isPrimarySalaryLine = accountName.includes("薪資") && !accountName.includes("退休") && !accountName.includes("津貼");

  let baseline: number;
  if (commonCategory === "PERSONNEL") {
    const perPerson = avgMonthlySalary(departmentCode);
    if (isPrimarySalaryLine) {
      // A department can have more than one "primary salary" account (e.g.
      // production's 直接人工-薪資 vs 間接人工-薪資) - vary each by its own
      // account code so they don't come out byte-identical, while both stay
      // the dominant personnel line.
      const perAccountFactor = 0.92 + ratio(`${departmentCode}:${accountCode}:primarySalary`) * 0.16;
      baseline = headcount * perPerson * 12 * perAccountFactor;
    } else {
      const variableFactor = 0.15 + ratio(`${departmentCode}:${accountCode}:bonus`) * 0.6;
      baseline = headcount * perPerson * variableFactor;
    }
  } else {
    const spread = ratio(`${departmentCode}:${accountCode}:exp`);
    baseline = classScale * 20000 * (1 + spread * 4);
  }

  if (!isPrimarySalaryLine) {
    const zeroOutRoll = ratio(`${departmentCode}:${accountCode}:zero`);
    if (zeroOutRoll < 0.15) return 0;
  }

  return Math.round(baseline / 100) * 100;
}
