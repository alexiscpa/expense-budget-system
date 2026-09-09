import { Decimal, sumDecimals, growthRate } from "@/lib/money/decimal";
import type { AccountCommonCategory, BudgetStatus, DeptClass } from "@prisma/client";

/**
 * Framework-free, multi-department extension of the budget summary preview
 * data layer (`/dashboard/reports/budget-summary-preview`). Deliberately a
 * SEPARATE module from `summaryReportData.ts` (which stays exactly as it
 * was, still feeding the Excel/PDF export routes with 財務管理處-only data
 * unchanged) - this one is used only by the on-screen preview, which now
 * looks up every department in Stage2A + 財務管理處 by real code instead of
 * hard-coding a single department.
 *
 * Core distinction this module makes that the single-department layer
 * never needed to: "no 2027 figure has been entered yet" (render "—") is
 * NOT the same as "a real, confirmed amount of exactly 0" (render "0") -
 * see buildDeptAgg/buildLineAgg below. The 2026 reference figure has no
 * such ambiguity: it either exists (this department has a fiscalYear=2027
 * BudgetVersion with lines) or it doesn't (未編製), independent of whether
 * anyone has touched the 2027 columns yet or whether the version has been
 * submitted/approved.
 */

export interface DeptLineDto {
  id: string;
  priorYearOriginalBudget: string;
  nextYearTargetExcludingNew: string;
  nextYearNewHireBudget: string;
  nextYearTotal: string;
  createdAt: string;
  updatedAt: string;
  account: { code: string; name: string; commonCategory: AccountCommonCategory };
}

export interface DeptVersionDto {
  id: string;
  status: BudgetStatus;
  priorYearHeadcount: number | null;
  budgetYearHeadcount: number;
  lastPreparedAt: string;
  createdAt: string;
  lines: DeptLineDto[];
}

export interface DeptSummaryEntry {
  code: string;
  name: string;
  class: DeptClass;
  isTestData: boolean;
  /** null = no fiscalYear=2027 BudgetVersion exists at all yet (未編製). */
  version: DeptVersionDto | null;
}

/**
 * A single BudgetLine "has been entered" the same way BudgetVersionClient's
 * own `isUntouched` check works: createdAt === updatedAt means this exact
 * line has never been written to since the seed/draft created it - Prisma's
 * `@updatedAt` bumps updatedAt on every real save, even one that re-saves
 * the same figure, so this can never false-negative on "the user typed 0".
 */
export function lineIsTouched(line: DeptLineDto): boolean {
  return line.updatedAt !== line.createdAt;
}

/** A whole BudgetVersion "has budget input" once anything on it (a line, or
 * the department headcount) has actually been saved - lastPreparedAt only
 * ever moves on a real content write (see BudgetVersion.lastPreparedAt's
 * schema comment), never on draft creation itself. */
export function versionHasBudgetInput(version: DeptVersionDto | null): boolean {
  return Boolean(version && version.lastPreparedAt !== version.createdAt);
}

export interface DeptAgg {
  /** 2026 reference total - always real once a version exists, regardless of 2027 input status. */
  priorTotal: Decimal;
  excludingNewTotal: Decimal | null;
  newHireTotal: Decimal | null;
  grandTotal: Decimal | null;
  delta: Decimal | null;
  growth: Decimal | null;
}

/** Whole-department aggregate. 2027 columns are null ("—") until this
 * department's own version has had any input; 2026 always reflects the
 * stored reference figures. */
export function buildDeptAgg(version: DeptVersionDto | null): DeptAgg | null {
  if (!version) return null;
  const priorTotal = sumDecimals(version.lines.map((l) => l.priorYearOriginalBudget));
  if (!versionHasBudgetInput(version)) {
    return { priorTotal, excludingNewTotal: null, newHireTotal: null, grandTotal: null, delta: null, growth: null };
  }
  const excludingNewTotal = sumDecimals(version.lines.map((l) => l.nextYearTargetExcludingNew));
  const newHireTotal = sumDecimals(version.lines.map((l) => l.nextYearNewHireBudget));
  const grandTotal = sumDecimals(version.lines.map((l) => l.nextYearTotal));
  return {
    priorTotal,
    excludingNewTotal,
    newHireTotal,
    grandTotal,
    delta: grandTotal.minus(priorTotal),
    growth: growthRate(priorTotal, grandTotal),
  };
}

export interface LineAgg {
  prior: Decimal;
  excludingNew: Decimal | null;
  newHire: Decimal | null;
  total: Decimal | null;
  deltaExcl: Decimal | null;
  growthExcl: Decimal | null;
  deltaTotal: Decimal | null;
  growthTotal: Decimal | null;
}

/**
 * Aggregate over an arbitrary set of lines - a single account row (pass one
 * line), a category subtotal within one department, or a category subtotal
 * pooled across every in-scope department (see the SGA/production tables).
 * 2027 columns are null ("—") only when NONE of the lines in this group has
 * ever been touched; once at least one has, the group's real sum is shown
 * (an untouched line's own 0 contributes numerically like any other line -
 * it is only ever individually re-displayed as "—" at the single-line level
 * via lineIsTouched, never hidden from a subtotal it is part of).
 */
export function buildLineAgg(lines: DeptLineDto[]): LineAgg {
  const prior = sumDecimals(lines.map((l) => l.priorYearOriginalBudget));
  if (!lines.some(lineIsTouched)) {
    return { prior, excludingNew: null, newHire: null, total: null, deltaExcl: null, growthExcl: null, deltaTotal: null, growthTotal: null };
  }
  const excludingNew = sumDecimals(lines.map((l) => l.nextYearTargetExcludingNew));
  const newHire = sumDecimals(lines.map((l) => l.nextYearNewHireBudget));
  const total = sumDecimals(lines.map((l) => l.nextYearTotal));
  return {
    prior,
    excludingNew,
    newHire,
    total,
    deltaExcl: excludingNew.minus(prior),
    growthExcl: growthRate(prior, excludingNew),
    deltaTotal: total.minus(prior),
    growthTotal: growthRate(prior, total),
  };
}

/** SGA scope (管銷研): 營業/管理/研發 - everything except production. */
export function isSgaClass(deptClass: DeptClass): boolean {
  return deptClass === "S" || deptClass === "M" || deptClass === "R";
}

/** Production scope (生產): production departments only. */
export function isProductionClass(deptClass: DeptClass): boolean {
  return deptClass === "P";
}
