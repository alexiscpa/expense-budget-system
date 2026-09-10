import type { DeptClass, DomesticOverseas } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { BUDGET_OWNER_ROSTER, BUDGET_OWNER_ROSTER_SIZE } from "@/lib/masterdata/budgetOwnerRoster";
import { getRollupParentName } from "@/lib/reference/departmentRollups";
import { STAGE2B_BUDGET_FISCAL_YEAR } from "@/lib/budget/stage2bDraftService";

/**
 * The 8 states defined for Stage 2B-2's progress dashboard. Deliberately
 * NOT derived from BudgetStatus === createdAt/updatedAt equality anywhere -
 * see docs/stage2b1-department-reconciliation.md §7.2 for why that
 * heuristic is unreliable. NOT_STARTED/DRAFT_EMPTY/IN_PROGRESS/
 * READY_TO_SUBMIT are all derived from real confirmation signals
 * (BudgetVersion existence, BudgetLine.inputConfirmedAt,
 * BudgetVersion.headcountConfirmedAt/preparationCompletedAt); the rest map
 * directly onto the existing BudgetStatus enum.
 */
export type Stage2bWorkflowStatus =
  | "NOT_STARTED"
  | "DRAFT_EMPTY"
  | "IN_PROGRESS"
  | "READY_TO_SUBMIT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "RETURNED"
  | "APPROVED";

export interface Stage2bDepartmentProgress {
  code: string;
  name: string;
  class: DeptClass;
  domesticOrOverseas: DomesticOverseas;
  rollupParentCode: string | null;
  rollupParentName: string | null;
  departmentExists: boolean;
  departmentId: string | null;
  versionId: string | null;
  status: Stage2bWorkflowStatus;
  /** Raw BudgetStatus, only meaningful when versionId is set - kept alongside
   * the derived Stage2bWorkflowStatus so a status this dashboard doesn't
   * explicitly enumerate (LOCKED/ADJUSTMENT_PENDING/ADJUSTED/REJECTED) is
   * never silently misrepresented. */
  rawBudgetStatus: string | null;
  headcount2026: number | null;
  total2026: string | null;
  headcount2027: number | null;
  total2027: string | null;
  confirmedLineCount: number;
  applicableLineCount: number;
  completionPercent: number | null;
  lastPreparedAt: string | null;
}

export interface Stage2bProgressSummary {
  totalDepartments: number;
  notStarted: number;
  inProgress: number;
  readyToSubmit: number;
  submitted: number;
  underReview: number;
  returned: number;
  approved: number;
  /** Departments started but not yet initialized as a Department row at all - a setup gap, not a workflow state. */
  notYetInSystem: number;
  startedCount: number;
  completedPreparationCount: number;
  submittedOrBeyondCount: number;
  startedPercent: number;
  completedPreparationPercent: number;
  submittedPercent: number;
}

function toPercent(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * Loads per-department progress rows for all 45 Stage 2B-2 roster
 * departments, and a summary rollup. The denominator is ALWAYS
 * BUDGET_OWNER_ROSTER_SIZE (45) - never a count derived from however many
 * Department/BudgetVersion rows happen to exist in the database - so it
 * cannot drift even if master-data initialization has only partially run,
 * or if a future stage adds unrelated Department rows for some other
 * purpose (see Stage 2B-2 §四 "45個部門進度分母固定正確").
 */
export async function loadStage2bProgress(): Promise<{
  rows: Stage2bDepartmentProgress[];
  summary: Stage2bProgressSummary;
}> {
  const codes = BUDGET_OWNER_ROSTER.map((r) => r.code);
  const departments = await prisma.department.findMany({ where: { code: { in: codes } } });
  const deptByCode = new Map(departments.map((d) => [d.code, d]));

  const departmentIds = departments.map((d) => d.id);
  const versions =
    departmentIds.length > 0
      ? await prisma.budgetVersion.findMany({
          where: { departmentId: { in: departmentIds }, fiscalYear: STAGE2B_BUDGET_FISCAL_YEAR, versionNumber: 1 },
          include: { lines: true },
        })
      : [];
  const versionByDeptId = new Map(versions.map((v) => [v.departmentId, v]));

  const rows: Stage2bDepartmentProgress[] = BUDGET_OWNER_ROSTER.map((entry) => {
    const dept = deptByCode.get(entry.code);
    const version = dept ? versionByDeptId.get(dept.id) : undefined;

    const applicableLines = version ? version.lines.filter((l) => !l.isLocked) : [];
    const confirmedLines = applicableLines.filter((l) => l.inputConfirmedAt !== null);
    const applicableLineCount = applicableLines.length;
    const confirmedLineCount = confirmedLines.length;

    let status: Stage2bWorkflowStatus;
    if (!dept || !version) {
      status = "NOT_STARTED";
    } else if (version.status === "SUBMITTED") {
      status = "SUBMITTED";
    } else if (version.status === "UNDER_REVIEW") {
      status = "UNDER_REVIEW";
    } else if (version.status === "RETURNED") {
      status = "RETURNED";
    } else if (version.status === "APPROVED" || version.status === "LOCKED" || version.status === "ADJUSTED") {
      status = "APPROVED";
    } else if (version.status === "DRAFT" || version.status === "ADJUSTMENT_PENDING") {
      if (version.preparationCompletedAt !== null) {
        status = "READY_TO_SUBMIT";
      } else if (confirmedLineCount > 0 || version.headcountConfirmedAt !== null) {
        status = "IN_PROGRESS";
      } else {
        status = "DRAFT_EMPTY";
      }
    } else {
      // REJECTED or any future status this dashboard doesn't explicitly
      // model - surfaced via rawBudgetStatus rather than silently folded
      // into another bucket.
      status = "DRAFT_EMPTY";
    }

    // 2026推估: only ever the department's own confirmed reference figures
    // (Department.priorYearHeadcount / each line's currentYearProjection,
    // both of which are null/never-set unless imported from a real,
    // controlled source - see createBudgetVersionDraft). Never fabricated
    // for a department with no such reference; total2026 is null (renders
    // "—") when there is no version to sum lines from at all.
    const total2026 = version
      ? version.lines.reduce((sum, l) => sum + Number(l.currentYearProjection ?? 0), 0).toFixed(0)
      : null;

    const total2027 = version
      ? version.lines.reduce((sum, l) => sum + Number(l.nextYearTotal), 0).toFixed(0)
      : null;

    return {
      code: entry.code,
      name: entry.name,
      class: entry.class,
      domesticOrOverseas: entry.domesticOrOverseas,
      rollupParentCode: entry.rollupParentCode,
      rollupParentName: getRollupParentName(entry.rollupParentCode),
      departmentExists: Boolean(dept),
      departmentId: dept?.id ?? null,
      versionId: version?.id ?? null,
      status,
      rawBudgetStatus: version?.status ?? null,
      headcount2026: dept?.priorYearHeadcount ?? null,
      total2026,
      headcount2027: version?.headcountConfirmedAt ? version.budgetYearHeadcount : null,
      total2027,
      confirmedLineCount,
      applicableLineCount,
      // 完成百分比 depends on human-confirmed state, not raw stored values -
      // a confirmed 0 counts fully; the schema-default 0 on an unconfirmed
      // line counts as 0% for that line, never silently as "done".
      completionPercent: applicableLineCount > 0 ? toPercent(confirmedLineCount, applicableLineCount) : version ? 100 : null,
      lastPreparedAt: version?.lastPreparedAt?.toISOString() ?? null,
    };
  });

  const notYetInSystem = rows.filter((r) => !r.departmentExists).length;
  const notStarted = rows.filter((r) => r.status === "NOT_STARTED").length;
  const draftEmptyOrInProgress = rows.filter((r) => r.status === "DRAFT_EMPTY" || r.status === "IN_PROGRESS").length;
  const readyToSubmit = rows.filter((r) => r.status === "READY_TO_SUBMIT").length;
  const submitted = rows.filter((r) => r.status === "SUBMITTED").length;
  const underReview = rows.filter((r) => r.status === "UNDER_REVIEW").length;
  const returned = rows.filter((r) => r.status === "RETURNED").length;
  const approved = rows.filter((r) => r.status === "APPROVED").length;

  const startedCount = BUDGET_OWNER_ROSTER_SIZE - notStarted;
  // "已完成編製部門數": preparationCompletedAt currently set (READY_TO_SUBMIT),
  // OR the version has already moved past DRAFT into submitted/reviewed/
  // approved territory - which can only happen once preparation was in
  // fact finished, even for a version submitted before completePreparation
  // existed (e.g. this repo's own pre-existing 17103 test data).
  const completedPreparationCount = rows.filter(
    (r) => r.status === "READY_TO_SUBMIT" || r.status === "SUBMITTED" || r.status === "UNDER_REVIEW" || r.status === "APPROVED"
  ).length;
  const submittedOrBeyondCount = rows.filter(
    (r) => r.status === "SUBMITTED" || r.status === "UNDER_REVIEW" || r.status === "APPROVED"
  ).length;

  return {
    rows,
    summary: {
      totalDepartments: BUDGET_OWNER_ROSTER_SIZE,
      notStarted,
      inProgress: draftEmptyOrInProgress,
      readyToSubmit,
      submitted,
      underReview,
      returned,
      approved,
      notYetInSystem,
      startedCount,
      completedPreparationCount,
      submittedOrBeyondCount,
      startedPercent: toPercent(startedCount, BUDGET_OWNER_ROSTER_SIZE),
      completedPreparationPercent: toPercent(completedPreparationCount, BUDGET_OWNER_ROSTER_SIZE),
      submittedPercent: toPercent(submittedOrBeyondCount, BUDGET_OWNER_ROSTER_SIZE),
    },
  };
}
