import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit/log";
import { STAGE2A_DEPARTMENTS } from "./stage2aDepartments";
import { STAGE2A_ACCOUNTS } from "./stage2aAccounts";
import { projectedHeadcount, projectedAccountAmount } from "./deterministicAmounts";

export const STAGE2A_PROJECTION_FISCAL_YEAR = 2026;
export const STAGE2A_BUDGET_FISCAL_YEAR = 2027;
const HEADCOUNT_SOURCE_TYPE = "STAGE2A_TEST_SEED_2026_PROJECTION";

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
  departmentsCreated: number;
  departmentsAlreadyExisted: number;
  accountsCreated: number;
  accountsAlreadyExisted: number;
  headcountRowsCreated: number;
  headcountRowsAlreadyExisted: number;
  budgetVersionsCreated: number;
  budgetVersionsAlreadyExisted: number;
  budgetLinesCreated: number;
  budgetLinesAlreadyExisted: number;
  departments: Stage2aDepartmentSummary[];
}

/**
 * Creates (idempotently) the 8 Stage 2A representative test departments, the
 * full real chart-of-accounts master (STAGE2A_ACCOUNTS - sourced from the
 * actual finance workbooks, see that module's header comment), each
 * department's 2026 projected headcount, and a DRAFT 2027 BudgetVersion per
 * department pre-populated with each applicable account's 2026 projected
 * amount (currentYearProjection) while every 2027 figure stays at the
 * system's normal "unfilled" value (0, editable) - never SUBMITTED/APPROVED.
 *
 * Deliberately avoids per-row interactive-transaction writes (createMany /
 * upsert-by-batch only) so the query count stays a small constant regardless
 * of the ~476 budget lines involved, per the Stage 2A anti-P2028
 * requirement. Never touches any department, account, or budget version
 * outside the 8 test department codes - in particular it never reads or
 * writes anything belonging to 財務管理處 (17203).
 */
export async function runStage2ATestSeed(actor: CurrentUser): Promise<Stage2aSeedResult> {
  return prisma.$transaction(async (tx) => {
    // --- 1. Departments (idempotent) ---------------------------------
    const deptCreate = await tx.department.createMany({
      data: STAGE2A_DEPARTMENTS.map((d) => ({
        code: d.code,
        name: d.name,
        class: d.class,
        isActive: true,
        isTestData: true,
      })),
      skipDuplicates: true,
    });

    const departments = await tx.department.findMany({
      where: { code: { in: STAGE2A_DEPARTMENTS.map((d) => d.code) } },
    });
    const departmentByCode = new Map(departments.map((d) => [d.code, d]));

    // --- 2. Accounts (idempotent, full real chart-of-accounts master) --
    const accountCreate = await tx.account.createMany({
      data: STAGE2A_ACCOUNTS.map((a) => ({
        code: a.code,
        name: a.name,
        majorCategory: a.majorCategory,
        commonCategory: a.commonCategory,
        entryType: a.entryType,
        formulaKey: a.formulaKey,
        isActive: true,
      })),
      skipDuplicates: true,
    });

    const accounts = await tx.account.findMany({
      where: { code: { in: STAGE2A_ACCOUNTS.map((a) => a.code) } },
    });
    const accountsByCode = new Map(accounts.map((a) => [a.code, a]));
    const accountsByClass = new Map<string, typeof accounts>();
    for (const a of accounts) {
      const list = accountsByClass.get(a.majorCategory) ?? [];
      list.push(a);
      accountsByClass.set(a.majorCategory, list);
    }

    // --- 3. 2026 projected headcount (idempotent, one row per dept/year) --
    const headcountRows = STAGE2A_DEPARTMENTS.map((d) => ({
      departmentId: departmentByCode.get(d.code)!.id,
      fiscalYear: STAGE2A_PROJECTION_FISCAL_YEAR,
      headcount: projectedHeadcount(d.code, d.class),
      sourceType: HEADCOUNT_SOURCE_TYPE,
      isTestData: true,
    }));
    const headcountCreate = await tx.departmentHeadcount.createMany({
      data: headcountRows,
      skipDuplicates: true,
    });
    const headcountByDeptId = new Map(headcountRows.map((h) => [h.departmentId, h.headcount]));

    // --- 4. DRAFT 2027 BudgetVersion per department (idempotent) ---------
    const versionCreate = await tx.budgetVersion.createMany({
      data: STAGE2A_DEPARTMENTS.map((d) => ({
        departmentId: departmentByCode.get(d.code)!.id,
        fiscalYear: STAGE2A_BUDGET_FISCAL_YEAR,
        versionNumber: 1,
        status: "DRAFT" as const,
        preparedById: actor.id,
        isTestData: true,
      })),
      skipDuplicates: true,
    });

    const versions = await tx.budgetVersion.findMany({
      where: {
        departmentId: { in: departments.map((d) => d.id) },
        fiscalYear: STAGE2A_BUDGET_FISCAL_YEAR,
        versionNumber: 1,
      },
    });
    const versionByDeptId = new Map(versions.map((v) => [v.departmentId, v]));

    // --- 5. BudgetLine per (department, applicable account) (idempotent) -
    const lineRows: Prisma.BudgetLineCreateManyInput[] = [];
    const summaries: Stage2aDepartmentSummary[] = [];

    for (const d of STAGE2A_DEPARTMENTS) {
      const dept = departmentByCode.get(d.code)!;
      const version = versionByDeptId.get(dept.id)!;
      const applicableAccounts = accountsByClass.get(d.class) ?? [];
      const headcount = headcountByDeptId.get(dept.id)!;

      let deptTotal = 0;
      for (const account of applicableAccounts) {
        const seedMeta = accountsByCode.get(account.code)!;
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

        const formulaStatus = account.entryType === "FORMULA" ? "NOT_CONFIGURED" : "NOT_APPLICABLE";
        const isLocked = account.entryType !== "DEPARTMENT_INPUT";

        lineRows.push({
          budgetVersionId: version.id,
          accountId: account.id,
          priorPriorYearActual: 0,
          priorYearOriginalBudget: 0,
          currentYearProjection: amount,
          projectionIsComplete: true,
          nextYearTargetExcludingNew: 0,
          nextYearNewHireBudget: 0,
          nextYearTotal: 0,
          growthRateExcludingNew: null,
          growthRateIncludingNew: null,
          entryTypeSnapshot: account.entryType,
          formulaStatus,
          isLocked,
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

    const lineCreate = await tx.budgetLine.createMany({
      data: lineRows,
      skipDuplicates: true,
    });

    await writeAuditLog(
      {
        actorUserId: actor.id,
        action: "STAGE2A_STRESS_SEED",
        entityType: "Stage2ATestSeed",
        afterData: {
          departmentCodes: STAGE2A_DEPARTMENTS.map((d) => d.code),
          projectionFiscalYear: STAGE2A_PROJECTION_FISCAL_YEAR,
          budgetFiscalYear: STAGE2A_BUDGET_FISCAL_YEAR,
          departmentsCreated: deptCreate.count,
          accountsCreated: accountCreate.count,
          headcountRowsCreated: headcountCreate.count,
          budgetVersionsCreated: versionCreate.count,
          budgetLinesCreated: lineCreate.count,
        },
      },
      tx
    );

    return {
      departmentsCreated: deptCreate.count,
      departmentsAlreadyExisted: STAGE2A_DEPARTMENTS.length - deptCreate.count,
      accountsCreated: accountCreate.count,
      accountsAlreadyExisted: STAGE2A_ACCOUNTS.length - accountCreate.count,
      headcountRowsCreated: headcountCreate.count,
      headcountRowsAlreadyExisted: STAGE2A_DEPARTMENTS.length - headcountCreate.count,
      budgetVersionsCreated: versionCreate.count,
      budgetVersionsAlreadyExisted: STAGE2A_DEPARTMENTS.length - versionCreate.count,
      budgetLinesCreated: lineCreate.count,
      budgetLinesAlreadyExisted: lineRows.length - lineCreate.count,
      departments: summaries,
    };
  });
}
