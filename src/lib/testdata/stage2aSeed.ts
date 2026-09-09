import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "@/lib/auth/session";
import { isTestBypassUser } from "@/lib/auth/testBypass";
import { isAuthBypassEnabled } from "@/lib/env";
import { ApiError } from "@/lib/rbac/guard";
import { buildAuditLogData } from "@/lib/audit/log";
import { deriveLineTotals } from "@/lib/budget/lineService";
import { STAGE2A_DEPARTMENTS } from "./stage2aDepartments";
import { STAGE2A_ACCOUNTS } from "./stage2aAccounts";
import { projectedHeadcount, projectedAccountAmount } from "./deterministicAmounts";

function assertBypassEnabled(): void {
  if (!isAuthBypassEnabled()) {
    throw new ApiError(403, "此功能僅限 Vercel Preview 測試環境（AUTH_DISABLED=true）使用");
  }
}

export const STAGE2A_PROJECTION_FISCAL_YEAR = 2026;
export const STAGE2A_BUDGET_FISCAL_YEAR = 2027;

/** Deterministic, stable ids - re-running the seed always computes the same
 * id for the same department/account/version/line, so idempotency (via
 * createMany's skipDuplicates below) never depends on first reading back
 * what a previous run created. */
function departmentId(code: string): string {
  return `stage2a-dept-${code}`;
}
function accountId(code: string): string {
  return `stage2a-acct-${code}`;
}
function versionId(departmentCode: string): string {
  return `stage2a-ver-${departmentCode}-${STAGE2A_BUDGET_FISCAL_YEAR}`;
}
function lineId(departmentCode: string, accountCode: string): string {
  return `stage2a-line-${departmentCode}-${accountCode}`;
}

export interface Stage2aDepartmentSummary {
  code: string;
  name: string;
  class: "M" | "S" | "R" | "P";
  isOverseas: boolean;
  headcount2026: number;
  accountCount: number;
  totalProjection2026: string;
}

export interface Stage2aSeedResult {
  departmentsPlanned: number;
  departmentsCreated: number;
  accountsPlanned: number;
  accountsCreated: number;
  budgetVersionsPlanned: number;
  budgetVersionsCreated: number;
  budgetLinesPlanned: number;
  budgetLinesCreated: number;
  budgetLinesInspected: number;
  budgetLinesUnlocked: number;
  remainingLockedLines: number;
  remainingUnconfiguredFormulaLines: number;
  departments: Stage2aDepartmentSummary[];
}

/**
 * Creates (idempotently) the 8 Stage 2A representative test departments,
 * the accounts applicable to their classes (STAGE2A_ACCOUNTS - sourced from
 * the real finance workbooks, see that module's header comment), and a
 * DRAFT BudgetVersion per department for STAGE2A_BUDGET_FISCAL_YEAR (2027)
 * whose lines are pre-populated with each account's deterministic
 * STAGE2A_PROJECTION_FISCAL_YEAR (2026) projected amount - while every 2027
 * figure (nextYearTargetExcludingNew/nextYearNewHireBudget/justification)
 * stays at its normal "unfilled" value, never SUBMITTED/APPROVED. Every
 * applicable account - including ones the shared master data classifies as
 * FORMULA (薪資支出/端午獎金/中秋獎金/年終獎金/職工退休金 and the like) -
 * is snapshotted onto these 8 departments' own BudgetLine rows as editable
 * DEPARTMENT_INPUT, since no FormulaDefinition/SalaryDataSource is ever
 * seeded for them and Stage 2A's whole point is manual entry; see the
 * entryTypeSnapshot override in the account loop below for exactly what
 * this does and does not touch.
 *
 * Deliberately does NOT write through Account.priorYearReferenceAmount /
 * Department.priorYearHeadcount's normal createBudgetVersionDraft copy
 * path for the *account* amounts: that field is a single value shared by
 * every department using that Account row (see its schema comment), so it
 * can only ever represent the one department it was imported for - reusing
 * it here would make every M-class test department (both 資訊處 and
 * 行政管理處 use the same 62 shared M-class Account rows) silently overwrite
 * each other's 2026 figure for every shared account. Instead, this writes
 * each department's own distinct amount straight into its own BudgetLine
 * row, which is already uniquely keyed by (budgetVersionId, accountId) -
 * i.e. by (department, account, fiscal year) - so two departments sharing
 * the same Account can never collide. Department.priorYearHeadcount IS
 * used for the headcount reference, since that field is already one-row-
 * per-department (no sharing, no overwrite risk).
 *
 * All ids are deterministic (see the `*Id()` helpers above), so the entire
 * write is computed in-memory from STAGE2A_DEPARTMENTS/STAGE2A_ACCOUNTS
 * with zero preliminary read queries, and submitted as a single
 * non-interactive Prisma batch transaction (`$transaction([...])`, the
 * array form used throughout this codebase - see createBudgetVersionDraft
 * and seedDemoMasterData.ts for the same pattern and rationale): a fixed
 * handful of statements regardless of the ~476 budget lines involved, with
 * no interactive-transaction timeout to exceed and no per-row round trip
 * (avoiding the Neon P2028 failure mode). `skipDuplicates: true` on every
 * createMany makes re-running this endpoint fully idempotent for rows that
 * do not exist yet - but a row that already exists (e.g. an environment
 * seeded before the entryTypeSnapshot override above was introduced) is
 * left completely untouched by createMany/skipDuplicates, so re-running
 * this function alone would NOT retroactively unlock an already-existing
 * environment's old FORMULA/NOT_CONFIGURED/isLocked lines. The
 * `unlockLegacyFormulaLinesQuery` raw SQL statement below exists
 * specifically to upgrade those - see its own comment for exactly what it
 * does and does not touch. Because every id/code here is scoped to
 * STAGE2A_DEPARTMENTS'/STAGE2A_ACCOUNTS' own codes, and the upgrade query
 * additionally filters on both BudgetVersion.isTestData AND
 * Department.isTestData, none of this ever reads or writes anything
 * belonging to 財務管理處 (17203) or any other real department.
 */
export async function runStage2ATestSeed(actor: CurrentUser): Promise<Stage2aSeedResult> {
  assertBypassEnabled();

  const now = new Date();
  const preparedById = isTestBypassUser(actor) ? null : actor.id;

  const departmentRows: Prisma.DepartmentCreateManyInput[] = STAGE2A_DEPARTMENTS.map((d) => {
    const headcount = projectedHeadcount(d.code, d.class);
    return {
      id: departmentId(d.code),
      code: d.code,
      name: d.name,
      class: d.class,
      isActive: true,
      isTestData: true,
      priorYearHeadcount: headcount,
      priorYearReferenceFiscalYear: STAGE2A_PROJECTION_FISCAL_YEAR,
      createdAt: now,
      updatedAt: now,
    };
  });

  const accountRows: Prisma.AccountCreateManyInput[] = STAGE2A_ACCOUNTS.map((a) => ({
    id: accountId(a.code),
    code: a.code,
    name: a.name,
    majorCategory: a.majorCategory,
    commonCategory: a.commonCategory,
    entryType: a.entryType,
    formulaKey: a.formulaKey,
    isActive: true,
    // Deliberately left null - see this function's own doc comment above
    // for why the shared, single-value Account reference fields must never
    // carry one test department's amount for an account other departments
    // also use.
    priorYearReferenceAmount: null,
    priorYearReferenceFiscalYear: null,
    createdAt: now,
    updatedAt: now,
  }));

  const accountsByClass = new Map<"M" | "S" | "R" | "P", typeof STAGE2A_ACCOUNTS>();
  for (const a of STAGE2A_ACCOUNTS) {
    const list = accountsByClass.get(a.majorCategory) ?? [];
    list.push(a);
    accountsByClass.set(a.majorCategory, list);
  }

  const versionRows: Prisma.BudgetVersionCreateManyInput[] = [];
  const lineRows: Prisma.BudgetLineCreateManyInput[] = [];
  const summaries: Stage2aDepartmentSummary[] = [];

  for (const d of STAGE2A_DEPARTMENTS) {
    const headcount = projectedHeadcount(d.code, d.class);
    const vId = versionId(d.code);

    versionRows.push({
      id: vId,
      departmentId: departmentId(d.code),
      fiscalYear: STAGE2A_BUDGET_FISCAL_YEAR,
      versionNumber: 1,
      status: "DRAFT",
      preparedById,
      isTestData: true,
      // Matches createBudgetVersionDraft's own convention: the budget-year
      // figure starts equal to the confirmed prior-year reference (the
      // preparer overrides it, never left blank when a real reference
      // exists).
      priorYearHeadcount: headcount,
      budgetYearHeadcount: headcount,
      lastPreparedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    const applicableAccounts = accountsByClass.get(d.class) ?? [];
    let deptTotal = 0;

    for (const account of applicableAccounts) {
      const amount = projectedAccountAmount({
        departmentCode: d.code,
        deptClass: d.class,
        accountCode: account.code,
        accountName: account.name,
        commonCategory: account.commonCategory,
        entryType: account.entryType,
        headcount,
      });
      deptTotal += amount;

      // Stage 2A's whole purpose is letting a human type in every 2027
      // figure by hand - a FORMULA account with no FormulaDefinition/
      // SalaryDataSource ever seeded for these test accounts (see this
      // module's doc comment) would otherwise resolve NOT_CONFIGURED and
      // permanently lock the field behind "尚未設定", exactly like
      // createBudgetVersionDraft's own `if (!account.formulaKey)` branch -
      // which is correct for a REAL department (a locked field genuinely
      // needs a real formula/salary setup before anyone can submit), but
      // wrong here because no test department will ever get one. So this
      // snapshot - and only this snapshot, on these 8 departments' own
      // BudgetLine rows - is deliberately taken as DEPARTMENT_INPUT
      // whenever the shared Account is FORMULA, so the line is editable
      // like every other 2027 figure. The shared Account row itself keeps
      // its real `entryType: "FORMULA"` untouched (see accountRows above),
      // so a real department's own createBudgetVersionDraft still gets the
      // genuine FORMULA/locked behavior for the exact same account - this
      // override only ever changes what gets snapshotted into a Stage 2A
      // test department's own BudgetLine, never the shared master data.
      // NOT_BUDGETED accounts (固定為0，不編列) are intentionally left
      // alone - only FORMULA is overridden.
      const entryTypeSnapshot = account.entryType === "FORMULA" ? "DEPARTMENT_INPUT" : account.entryType;
      const formulaStatus = "NOT_APPLICABLE";
      const isLocked = entryTypeSnapshot !== "DEPARTMENT_INPUT";
      const derived = deriveLineTotals({
        priorYearOriginalBudget: amount,
        nextYearTargetExcludingNew: 0,
        nextYearNewHireBudget: 0,
      });

      lineRows.push({
        id: lineId(d.code, account.code),
        budgetVersionId: vId,
        accountId: accountId(account.code),
        priorPriorYearActual: 0,
        priorYearOriginalBudget: amount,
        currentYearProjection: amount,
        projectionIsComplete: true,
        nextYearTargetExcludingNew: 0,
        nextYearNewHireBudget: 0,
        nextYearTotal: derived.nextYearTotal,
        growthRateExcludingNew: derived.growthRateExcludingNew,
        growthRateIncludingNew: derived.growthRateIncludingNew,
        entryTypeSnapshot,
        formulaStatus,
        isLocked,
        justification: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    summaries.push({
      code: d.code,
      name: d.name,
      class: d.class,
      isOverseas: d.isOverseas,
      headcount2026: headcount,
      accountCount: applicableAccounts.length,
      totalProjection2026: deptTotal.toFixed(0),
    });
  }

  const stage2aVersionIds = STAGE2A_DEPARTMENTS.map((d) => versionId(d.code));

  // Upgrade path for an environment seeded before the entryTypeSnapshot
  // override above existed (e.g. Preview, already stress-seeded once): a
  // line that createMany/skipDuplicates left alone because it already
  // exists can still be sitting in some OLD locked state from before this
  // fix. Deliberately matches on entryTypeSnapshot='FORMULA' ALONE (not
  // also requiring formulaStatus='NOT_CONFIGURED'/isLocked=true, as an
  // earlier version of this query did) - post-fix, no Stage 2A line should
  // EVER be snapshotted as FORMULA (see the entryTypeSnapshot override
  // above), so any line still carrying that value is, by definition, a
  // leftover from a prior code version, regardless of exactly which
  // formulaStatus/isLocked combination that prior version happened to
  // write (NOT_CONFIGURED, a stale CONFIGURED, or anything else) - one
  // broad condition on the single invariant that is actually guaranteed,
  // rather than an exact-match on values that could vary across the
  // history of this seed. A genuinely real department's own
  // createBudgetVersionDraft-created NOT_CONFIGURED lines are excluded
  // here by requiring BOTH bv."isTestData" AND d."isTestData", and are
  // further narrowed to just this run's own deterministic version ids -
  // so this can never touch 財務管理處 or any other real department's
  // legitimately-unconfigured formula lines.
  //
  // Deliberately a raw UPDATE naming only these three columns: it does NOT
  // go through Prisma's `update`/`updateMany`, so BudgetLine.updatedAt
  // (which Prisma's `@updatedAt` would otherwise silently bump on any
  // `.update()` call) is left completely untouched - critical, since
  // `updatedAt === createdAt` is exactly how the summary report
  // (lineIsTouched in multiDepartmentSummary.ts) and the budget page
  // (isUntouched in BudgetVersionClient.tsx) tell "never entered by a
  // user" apart from "confirmed 0"; bumping it here would wrongly make an
  // untouched line look touched and show a fabricated 0 instead of "—".
  // A line that is still locked can never have real
  // nextYearTargetExcludingNew/nextYearNewHireBudget/justification from a
  // user in the first place (updateDepartmentInputLine rejects any write
  // while isLocked is true - see lib/budget/lineService.ts), so unlocking
  // it here cannot discard real user input. BudgetVersion.status is never
  // referenced or written by this query, so an already-SUBMITTED/APPROVED
  // test version is never reverted to DRAFT. Naturally idempotent: once a
  // line has been upgraded its entryTypeSnapshot is no longer FORMULA, so
  // a later re-run's WHERE clause simply matches nothing for it.
  const unlockLegacyFormulaLinesQuery = prisma.$executeRaw`
    UPDATE "BudgetLine" AS bl
    SET "entryTypeSnapshot" = 'DEPARTMENT_INPUT'::"AccountEntryType",
        "formulaStatus" = 'NOT_APPLICABLE'::"FormulaStatus",
        "isLocked" = false
    FROM "BudgetVersion" AS bv
    JOIN "Department" AS d ON d."id" = bv."departmentId"
    WHERE bl."budgetVersionId" = bv."id"
      AND bv."id" IN (${Prisma.join(stage2aVersionIds)})
      AND bv."isTestData" = true
      AND d."isTestData" = true
      AND bl."entryTypeSnapshot" = 'FORMULA'::"AccountEntryType"
  `;

  const auditLogQuery = prisma.auditLog.create({
    data: buildAuditLogData({
      actorUserId: actor.id,
      action: "STAGE2A_STRESS_SEED",
      entityType: "Stage2ATestSeed",
      entityId: randomUUID(),
      afterData: {
        departmentCodes: STAGE2A_DEPARTMENTS.map((d) => d.code),
        projectionFiscalYear: STAGE2A_PROJECTION_FISCAL_YEAR,
        budgetFiscalYear: STAGE2A_BUDGET_FISCAL_YEAR,
      },
    }),
  });

  const [deptResult, acctResult, versionResult, lineResult, unlockedCount] = await prisma.$transaction([
    prisma.department.createMany({ data: departmentRows, skipDuplicates: true }),
    prisma.account.createMany({ data: accountRows, skipDuplicates: true }),
    prisma.budgetVersion.createMany({ data: versionRows, skipDuplicates: true }),
    prisma.budgetLine.createMany({ data: lineRows, skipDuplicates: true }),
    unlockLegacyFormulaLinesQuery,
    auditLogQuery,
  ]);

  // Read-your-own-write verification, independent of the UPDATE's own row
  // count: re-query the same 8 departments' lines from scratch and confirm
  // none of them are still locked behind a formula. This is deliberately
  // NOT trusted to the transaction above succeeding "in principle" - if any
  // line here is still entryTypeSnapshot=FORMULA or formulaStatus=
  // NOT_CONFIGURED, this function throws rather than returning a success
  // shape, so the API (see api/demo/stage2a-seed/route.ts) can never report
  // "初始化成功" while a real department preparer would still see 尚未設定.
  const residualLines = await prisma.budgetLine.findMany({
    where: {
      budgetVersionId: { in: stage2aVersionIds },
      budgetVersion: { isTestData: true },
      OR: [{ entryTypeSnapshot: "FORMULA" }, { formulaStatus: "NOT_CONFIGURED" }],
    },
    include: { account: true, budgetVersion: { include: { department: true } } },
  });
  const remainingLockedLines = residualLines.filter((l) => l.entryTypeSnapshot === "FORMULA").length;
  const remainingUnconfiguredFormulaLines = residualLines.filter((l) => l.formulaStatus === "NOT_CONFIGURED").length;
  const budgetLinesInspected = await prisma.budgetLine.count({ where: { budgetVersionId: { in: stage2aVersionIds } } });

  if (remainingLockedLines > 0 || remainingUnconfiguredFormulaLines > 0) {
    const codes = residualLines.map((l) => `${l.budgetVersion.department.code}/${l.account.code}`).join("、");
    throw new ApiError(
      500,
      `Stage 2A 測試資料初始化未完全成功：仍有 ${residualLines.length} 筆科目維持鎖定或公式未設定狀態（尚未設定），不得視為成功。受影響科目（部門代碼/科目代碼）：${codes}`
    );
  }

  return {
    departmentsPlanned: departmentRows.length,
    departmentsCreated: deptResult.count,
    accountsPlanned: accountRows.length,
    accountsCreated: acctResult.count,
    budgetVersionsPlanned: versionRows.length,
    budgetVersionsCreated: versionResult.count,
    budgetLinesPlanned: lineRows.length,
    budgetLinesCreated: lineResult.count,
    budgetLinesInspected,
    budgetLinesUnlocked: unlockedCount,
    remainingLockedLines,
    remainingUnconfiguredFormulaLines,
    departments: summaries,
  };
}

/** Read-only check for whether the Stage 2A test data already exists - used
 * to render the dashboard panel's status without creating anything. */
export async function getStage2ASeedStatus(): Promise<Stage2aDepartmentSummary[] | null> {
  assertBypassEnabled();

  const departments = await prisma.department.findMany({
    where: { code: { in: STAGE2A_DEPARTMENTS.map((d) => d.code) } },
  });
  if (departments.length === 0) return null;

  const versions = await prisma.budgetVersion.findMany({
    where: { departmentId: { in: departments.map((d) => d.id) }, fiscalYear: STAGE2A_BUDGET_FISCAL_YEAR },
    include: { lines: true },
  });
  const versionByDeptId = new Map(versions.map((v) => [v.departmentId, v]));

  return STAGE2A_DEPARTMENTS.map((d) => {
    const dept = departments.find((row) => row.code === d.code);
    const version = dept ? versionByDeptId.get(dept.id) : undefined;
    const total = version ? version.lines.reduce((acc, l) => acc + Number(l.currentYearProjection ?? 0), 0) : 0;
    return {
      code: d.code,
      name: d.name,
      class: d.class,
      isOverseas: d.isOverseas,
      headcount2026: dept?.priorYearHeadcount ?? 0,
      accountCount: version?.lines.length ?? 0,
      totalProjection2026: total.toFixed(0),
    };
  });
}
