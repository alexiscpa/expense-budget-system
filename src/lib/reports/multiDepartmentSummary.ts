import { Decimal, sumDecimals, growthRate } from "@/lib/money/decimal";
import type { AccountCommonCategory, BudgetStatus, DeptClass } from "@prisma/client";
import { isMappedAccountCode, type ReportingAccountMapping } from "@/lib/reports/reportingAccountMap";

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

/**
 * Pools every line across `entries` (already filtered to the correct
 * departments/scope by the caller - e.g. isSgaClass) whose account.code
 * matches ANY of `mapping.sourceCodes` (M/S/R for a 管銷研 row, P for a
 * 生產 row) - i.e. one row per reportingAccountKey, never per
 * department+account (see reportingAccountMap.ts for why a static code
 * mapping is used instead of grouping by Account.code or Account.name at
 * query time). Reuses buildLineAgg's null-until-touched semantics for
 * 2027, so a reportingAccountKey with a real 2026 sum but no 2027 input
 * yet still shows "—" rather than a fabricated 0.
 */
export function buildReportingAccountAgg(entries: DeptSummaryEntry[], mapping: ReportingAccountMapping): LineAgg {
  const codes = new Set(Object.values(mapping.sourceCodes));
  const lines = entries.flatMap((e) => (e.version ? e.version.lines.filter((l) => codes.has(l.account.code)) : []));
  return buildLineAgg(lines);
}

export interface UnmappedAccountRow {
  departmentCode: string;
  departmentName: string;
  accountCode: string;
  accountName: string;
  line: DeptLineDto;
}

/**
 * Every BudgetLine across `entries` whose Account.code has no entry in
 * either reporting-account table (see reportingAccountMap.ts) - e.g.
 * 財務管理處's own manually-created demo account (code "3"). Listed
 * per-department, never merged with anything else (not even with another
 * unmapped line that happens to share a name), so a preparer/reviewer can
 * see exactly what still needs a real reportingAccountKey assigned instead
 * of it silently vanishing from - or being guessed into - the summary.
 */
export function buildUnmappedAccountRows(entries: DeptSummaryEntry[]): UnmappedAccountRow[] {
  const rows: UnmappedAccountRow[] = [];
  for (const e of entries) {
    if (!e.version) continue;
    for (const line of e.version.lines) {
      if (!isMappedAccountCode(line.account.code)) {
        rows.push({ departmentCode: e.code, departmentName: e.name, accountCode: line.account.code, accountName: line.account.name, line });
      }
    }
  }
  return rows;
}

export interface ScopeCompleteness {
  expectedDepartmentCount: number;
  draftDepartmentCount: number;
  inputDepartmentCount: number;
  submittedDepartmentCount: number;
  notPreparedDepartmentCount: number;
  notPreparedDepartmentNames: string[];
  /** Most recent lastPreparedAt across every department that already has a version - null when none has one yet. */
  lastUpdatedAt: string | null;
}

/**
 * Completeness summary for one whole scope's table (管銷研 or 生產) - shown
 * once above the table (應編部門數／已建立草稿部門數／已輸入部門數／已送出
 * 部門數／尚未編製部門數／資料更新時間), never repeated per row: row-level
 * coverage is identical for every reportingAccountKey in the same scope,
 * since a department's version, once created, always carries every account
 * applicable to its class (see stage2aSeed.ts) - so "which departments are
 * missing" is a property of the whole table, not of any one account row.
 *
 * "已送出部門數" = any status other than DRAFT (this version has been sent
 * to Finance at least once, even if later RETURNED for correction).
 */
export function buildScopeCompleteness(scopeEntries: DeptSummaryEntry[]): ScopeCompleteness {
  const withVersion = scopeEntries.filter((e): e is DeptSummaryEntry & { version: DeptVersionDto } => Boolean(e.version));
  const notPrepared = scopeEntries.filter((e) => !e.version);
  const lastUpdatedAt = withVersion.reduce<string | null>((latest, e) => {
    if (!latest || e.version.lastPreparedAt > latest) return e.version.lastPreparedAt;
    return latest;
  }, null);

  return {
    expectedDepartmentCount: scopeEntries.length,
    draftDepartmentCount: withVersion.length,
    inputDepartmentCount: withVersion.filter((e) => versionHasBudgetInput(e.version)).length,
    submittedDepartmentCount: withVersion.filter((e) => e.version.status !== "DRAFT").length,
    notPreparedDepartmentCount: notPrepared.length,
    notPreparedDepartmentNames: notPrepared.map((e) => e.name),
    lastUpdatedAt,
  };
}
