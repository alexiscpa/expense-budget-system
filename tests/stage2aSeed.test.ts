import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { createDepartment, createAccount, createUser, toCurrentUser } from "./helpers/factory";
import { prisma } from "@/lib/prisma";
import {
  runStage2ATestSeed,
  getStage2ASeedStatus,
  STAGE2A_PROJECTION_FISCAL_YEAR,
  STAGE2A_BUDGET_FISCAL_YEAR,
} from "@/lib/testdata/stage2aSeed";
import { STAGE2A_DEPARTMENTS } from "@/lib/testdata/stage2aDepartments";
import { STAGE2A_ACCOUNTS } from "@/lib/testdata/stage2aAccounts";
import { testBypassUser, TEST_BYPASS_USER_ID } from "@/lib/auth/testBypass";
import { ApiError } from "@/lib/rbac/guard";
import { updateDepartmentInputLine, createBudgetVersionDraft } from "@/lib/budget/lineService";
import { submitBudgetVersion } from "@/lib/workflow/actions";
import { grantDepartmentScope } from "./helpers/factory";

const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;
const ORIGINAL_AUTH_DISABLED = process.env.AUTH_DISABLED;

function setEnv(vercelEnv: string | undefined, authDisabled: string | undefined) {
  if (vercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = vercelEnv;
  if (authDisabled === undefined) delete process.env.AUTH_DISABLED;
  else process.env.AUTH_DISABLED = authDisabled;
}

afterEach(() => {
  setEnv(ORIGINAL_VERCEL_ENV, ORIGINAL_AUTH_DISABLED);
});

beforeEach(async () => {
  await resetDatabase();
});

async function seedFinanceManagementOfficeManualTestData() {
  // Mirrors the pre-existing manual test data (via seedDemoMasterData /
  // hand-built budget) that Stage 2A must never touch: 財務管理處 (17203),
  // a management account it uses, and a budget line with real figures.
  const fmo = await createDepartment({
    code: "17203",
    name: "財務管理處",
    class: "M",
    priorYearHeadcount: 10,
    priorYearReferenceFiscalYear: 2025,
  });
  const account = await createAccount({
    code: "3",
    name: "薪資支出",
    majorCategory: "M",
    commonCategory: "PERSONNEL",
    entryType: "DEPARTMENT_INPUT",
    priorYearReferenceAmount: "1234567",
    priorYearReferenceFiscalYear: 2025,
  });
  const owner = await createUser({ role: "BUDGET_OWNER" });
  const version = await prisma.budgetVersion.create({
    data: {
      departmentId: fmo.id,
      fiscalYear: 2026,
      versionNumber: 1,
      status: "DRAFT",
      preparedById: owner.id,
      priorYearHeadcount: 10,
      budgetYearHeadcount: 10,
      lastPreparedAt: new Date(),
    },
  });
  const line = await prisma.budgetLine.create({
    data: {
      budgetVersionId: version.id,
      accountId: account.id,
      priorPriorYearActual: 0,
      priorYearOriginalBudget: 1234567,
      currentYearProjection: 1234567,
      projectionIsComplete: true,
      nextYearTargetExcludingNew: 999999,
      nextYearNewHireBudget: 1,
      nextYearTotal: 1000000,
      entryTypeSnapshot: "DEPARTMENT_INPUT",
      isLocked: false,
      justification: "既有手動測試資料",
    },
  });
  return { fmo, account, version, line };
}

describe("Stage 2A stress seed - environment gating (fail-closed, matches seedDemoMasterData)", () => {
  it("refuses to run in Production even with AUTH_DISABLED=true, and creates nothing", async () => {
    setEnv("production", "true");
    await expect(runStage2ATestSeed(testBypassUser())).rejects.toThrow(ApiError);
    expect(await prisma.department.count()).toBe(0);
  });

  it("refuses to run in Preview when AUTH_DISABLED is not exactly 'true'", async () => {
    setEnv("preview", "false");
    await expect(runStage2ATestSeed(testBypassUser())).rejects.toThrow(ApiError);
    setEnv("preview", undefined);
    await expect(runStage2ATestSeed(testBypassUser())).rejects.toThrow(ApiError);
    expect(await prisma.department.count()).toBe(0);
  });

  it("refuses to run outside Vercel entirely (VERCEL_ENV unset), even with AUTH_DISABLED=true", async () => {
    setEnv(undefined, "true");
    await expect(runStage2ATestSeed(testBypassUser())).rejects.toThrow(ApiError);
  });

  it("getStage2ASeedStatus is gated the same way", async () => {
    setEnv("production", "true");
    await expect(getStage2ASeedStatus()).rejects.toThrow(ApiError);
  });
});

describe("Stage 2A stress seed - departments, accounts, budget drafts", () => {
  beforeEach(() => setEnv("preview", "true"));

  it("creates exactly 8 departments, 2 per class, with the overseas site classified S", async () => {
    const result = await runStage2ATestSeed(testBypassUser());

    expect(result.departments).toHaveLength(8);
    const byClass = new Map<string, number>();
    for (const d of result.departments) byClass.set(d.class, (byClass.get(d.class) ?? 0) + 1);
    expect(byClass.get("M")).toBe(2);
    expect(byClass.get("S")).toBe(2);
    expect(byClass.get("R")).toBe(2);
    expect(byClass.get("P")).toBe(2);

    const overseas = result.departments.find((d) => d.isOverseas);
    expect(overseas?.class).toBe("S");
    expect(overseas?.code).toBe("20001");

    expect(await prisma.department.count({ where: { isTestData: true } })).toBe(8);
  });

  it("is idempotent: running twice creates no duplicate departments, accounts, versions, or lines", async () => {
    const first = await runStage2ATestSeed(testBypassUser());
    const second = await runStage2ATestSeed(testBypassUser());

    expect(second.departmentsCreated).toBe(0);
    expect(second.accountsCreated).toBe(0);
    expect(second.budgetVersionsCreated).toBe(0);
    expect(second.budgetLinesCreated).toBe(0);

    expect(await prisma.department.count({ where: { isTestData: true } })).toBe(8);
    expect(await prisma.account.count()).toBe(STAGE2A_ACCOUNTS.length);
    expect(await prisma.budgetVersion.count({ where: { isTestData: true } })).toBe(8);
    expect(first.budgetLinesCreated).toBeGreaterThan(0);
  });

  it("never touches 財務管理處's existing manual test data (department, account, budget version, or line)", async () => {
    const { fmo, account, version, line } = await seedFinanceManagementOfficeManualTestData();

    await runStage2ATestSeed(testBypassUser());

    const fmoAfter = await prisma.department.findUnique({ where: { id: fmo.id } });
    expect(fmoAfter).toMatchObject({ code: "17203", name: "財務管理處", class: "M", isTestData: false });

    const accountAfter = await prisma.account.findUnique({ where: { id: account.id } });
    expect(accountAfter?.name).toBe("薪資支出");
    expect(accountAfter?.priorYearReferenceAmount?.toString()).toBe("1234567");

    const versionAfter = await prisma.budgetVersion.findUnique({ where: { id: version.id } });
    expect(versionAfter?.status).toBe("DRAFT");
    expect(versionAfter?.isTestData).toBe(false);
    expect(versionAfter?.budgetYearHeadcount).toBe(10);

    const lineAfter = await prisma.budgetLine.findUnique({ where: { id: line.id } });
    expect(lineAfter?.nextYearTargetExcludingNew.toString()).toBe("999999");
    expect(lineAfter?.justification).toBe("既有手動測試資料");

    expect(await prisma.department.count({ where: { isTestData: false } })).toBe(1);
  });

  it("only materializes accounts applicable to each department's own class", async () => {
    const result = await runStage2ATestSeed(testBypassUser());

    for (const dept of result.departments) {
      const expectedCount = STAGE2A_ACCOUNTS.filter((a) => a.majorCategory === dept.class).length;
      expect(dept.accountCount).toBe(expectedCount);

      const dbDept = await prisma.department.findUniqueOrThrow({ where: { code: dept.code } });
      const version = await prisma.budgetVersion.findFirstOrThrow({
        where: { departmentId: dbDept.id, fiscalYear: STAGE2A_BUDGET_FISCAL_YEAR },
        include: { lines: { include: { account: true } } },
      });
      expect(version.lines).toHaveLength(expectedCount);
      for (const line of version.lines) {
        expect(line.account.majorCategory).toBe(dept.class);
      }
    }
  });

  it("keeps 2026 projections isolated per department+account: two M departments sharing the same account get independent amounts", async () => {
    await runStage2ATestSeed(testBypassUser());

    const mDepts = STAGE2A_DEPARTMENTS.filter((d) => d.class === "M");
    expect(mDepts).toHaveLength(2);
    const sampleAccountCode = STAGE2A_ACCOUNTS.find((a) => a.majorCategory === "M")!.code;
    const account = await prisma.account.findUniqueOrThrow({ where: { code: sampleAccountCode } });

    const deptA = await prisma.department.findUniqueOrThrow({ where: { code: mDepts[0]!.code } });
    const deptB = await prisma.department.findUniqueOrThrow({ where: { code: mDepts[1]!.code } });
    const versionA = await prisma.budgetVersion.findFirstOrThrow({
      where: { departmentId: deptA.id, fiscalYear: STAGE2A_BUDGET_FISCAL_YEAR },
    });
    const versionB = await prisma.budgetVersion.findFirstOrThrow({
      where: { departmentId: deptB.id, fiscalYear: STAGE2A_BUDGET_FISCAL_YEAR },
    });
    const lineA = await prisma.budgetLine.findUniqueOrThrow({
      where: { budgetVersionId_accountId: { budgetVersionId: versionA.id, accountId: account.id } },
    });
    const lineB = await prisma.budgetLine.findUniqueOrThrow({
      where: { budgetVersionId_accountId: { budgetVersionId: versionB.id, accountId: account.id } },
    });

    // The shared Account row itself must never carry either department's
    // amount - this is exactly the overwrite risk avoided by writing
    // straight into each department's own BudgetLine instead.
    expect(account.priorYearReferenceAmount).toBeNull();

    // Mutating one department's line must never affect the other's.
    await prisma.budgetLine.update({ where: { id: lineA.id }, data: { currentYearProjection: 999999999 } });
    const lineBAfter = await prisma.budgetLine.findUniqueOrThrow({ where: { id: lineB.id } });
    expect(lineBAfter.currentYearProjection?.toNumber()).toBe(lineB.currentYearProjection?.toNumber());
    expect(lineBAfter.currentYearProjection?.toNumber()).not.toBe(999999999);
  });

  it("copies each department's own 2026 headcount/amount into its 2027 draft correctly (no year mix-up)", async () => {
    const result = await runStage2ATestSeed(testBypassUser());

    for (const dept of result.departments) {
      const dbDept = await prisma.department.findUniqueOrThrow({ where: { code: dept.code } });
      expect(dbDept.priorYearHeadcount).toBe(dept.headcount2026);
      expect(dbDept.priorYearReferenceFiscalYear).toBe(STAGE2A_PROJECTION_FISCAL_YEAR);

      const version = await prisma.budgetVersion.findFirstOrThrow({
        where: { departmentId: dbDept.id, fiscalYear: STAGE2A_BUDGET_FISCAL_YEAR },
      });
      // referenceYear = fiscalYear - 1 = 2026, matching the department's
      // own confirmed reference year - so the copy is valid, not a
      // mismatched-year figure relabeled as 2026's.
      expect(version.fiscalYear - 1).toBe(STAGE2A_PROJECTION_FISCAL_YEAR);
      expect(version.priorYearHeadcount).toBe(dept.headcount2026);
    }
  });

  it("leaves every 2027 figure blank/zero (never代填) and every version status DRAFT only", async () => {
    await runStage2ATestSeed(testBypassUser());

    const versions = await prisma.budgetVersion.findMany({ where: { isTestData: true }, include: { lines: true } });
    expect(versions).toHaveLength(8);
    for (const v of versions) {
      expect(v.status).toBe("DRAFT");
      expect(v.fiscalYear).toBe(STAGE2A_BUDGET_FISCAL_YEAR);
      for (const line of v.lines) {
        expect(line.nextYearTargetExcludingNew.toNumber()).toBe(0);
        expect(line.nextYearNewHireBudget.toNumber()).toBe(0);
        expect(line.nextYearTotal.toNumber()).toBe(0);
        expect(line.justification).toBeNull();
      }
    }
  });

  it("produces per-department 2026 totals that equal the sum of that department's own line items", async () => {
    const result = await runStage2ATestSeed(testBypassUser());

    for (const dept of result.departments) {
      const dbDept = await prisma.department.findUniqueOrThrow({ where: { code: dept.code } });
      const version = await prisma.budgetVersion.findFirstOrThrow({
        where: { departmentId: dbDept.id, fiscalYear: STAGE2A_BUDGET_FISCAL_YEAR },
        include: { lines: true },
      });
      const sum = version.lines.reduce((acc, l) => acc + (l.currentYearProjection?.toNumber() ?? 0), 0);
      expect(sum).toBe(Number(dept.totalProjection2026));
      // priorYearOriginalBudget mirrors currentYearProjection for this
      // seed (see stage2aSeed.ts) - it is what BudgetVersionClient.tsx
      // actually displays as "referenceYear年推估金額".
      const sumOriginal = version.lines.reduce((acc, l) => acc + l.priorYearOriginalBudget.toNumber(), 0);
      expect(sumOriginal).toBe(sum);
    }
  });

  it("gives every department non-zero, non-uniform 2026 amounts, with production clearly exceeding management", async () => {
    const result = await runStage2ATestSeed(testBypassUser());

    for (const dept of result.departments) {
      expect(Number(dept.totalProjection2026)).toBeGreaterThan(0);
      expect(dept.headcount2026).toBeGreaterThan(0);
    }

    const totalsByClass = new Map<string, number[]>();
    for (const dept of result.departments) {
      const list = totalsByClass.get(dept.class) ?? [];
      list.push(Number(dept.totalProjection2026));
      totalsByClass.set(dept.class, list);
    }
    const maxM = Math.max(...(totalsByClass.get("M") ?? []));
    const minP = Math.min(...(totalsByClass.get("P") ?? []));
    expect(minP).toBeGreaterThan(maxM);

    const amounts = result.departments.map((d) => Number(d.totalProjection2026));
    expect(new Set(amounts).size).toBeGreaterThan(1);
  });

  it("re-running the deterministic seed after a fresh reset reproduces identical totals (fixed rule, not random)", async () => {
    const first = await runStage2ATestSeed(testBypassUser());
    await resetDatabase();
    const second = await runStage2ATestSeed(testBypassUser());

    const totalsFirst = first.departments.map((d) => `${d.code}:${d.totalProjection2026}:${d.headcount2026}`).sort();
    const totalsSecond = second.departments.map((d) => `${d.code}:${d.totalProjection2026}:${d.headcount2026}`).sort();
    expect(totalsSecond).toEqual(totalsFirst);
  });

  it("writes a single AuditLog entry, correctly stripping the TEST_BYPASS_USER sentinel", async () => {
    await runStage2ATestSeed(testBypassUser());

    const logs = await prisma.auditLog.findMany({ where: { action: "STAGE2A_STRESS_SEED" } });
    expect(logs).toHaveLength(1);
    const log = logs[0]!;
    // TEST_BYPASS_USER_ID must never be written to the actorUserId FK (see
    // buildAuditLogData) - it is stripped to null with a marker in reason.
    expect(log.actorUserId).toBeNull();
    expect(log.reason).toContain("TEST_BYPASS_USER");
    const after = log.afterData as { departmentCodes: string[] };
    expect(after.departmentCodes).toHaveLength(8);
  });

  it("never writes TEST_BYPASS_USER_ID into BudgetVersion.preparedById", async () => {
    await runStage2ATestSeed(testBypassUser());
    const versions = await prisma.budgetVersion.findMany({ where: { isTestData: true } });
    for (const v of versions) {
      expect(v.preparedById).not.toBe(TEST_BYPASS_USER_ID);
      expect(v.preparedById).toBeNull();
    }
  });

  it("works with a real (non-bypass) SYSTEM_ADMIN user too, recording the real actor id", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    await runStage2ATestSeed(toCurrentUser(admin));

    const versions = await prisma.budgetVersion.findMany({ where: { isTestData: true } });
    for (const v of versions) {
      expect(v.preparedById).toBe(admin.id);
    }
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "STAGE2A_STRESS_SEED" } });
    expect(log.actorUserId).toBe(admin.id);
  });
});

describe("Stage 2A - salary/bonus accounts are editable, not locked behind 尚未設定", () => {
  beforeEach(() => setEnv("preview", "true"));

  it("every FORMULA-classified account is snapshotted as editable DEPARTMENT_INPUT on a Stage 2A line, never NOT_CONFIGURED/locked", async () => {
    const formulaAccountCodes = new Set(STAGE2A_ACCOUNTS.filter((a) => a.entryType === "FORMULA").map((a) => a.code));
    expect(formulaAccountCodes.size).toBeGreaterThan(0); // sanity: this scenario actually exists in the real data

    await runStage2ATestSeed(testBypassUser());

    const lines = await prisma.budgetLine.findMany({
      where: { budgetVersion: { isTestData: true } },
      include: { account: true },
    });
    const formulaLines = lines.filter((l) => formulaAccountCodes.has(l.account.code));
    expect(formulaLines.length).toBeGreaterThan(0);

    for (const line of formulaLines) {
      expect(line.entryTypeSnapshot).toBe("DEPARTMENT_INPUT");
      expect(line.formulaStatus).toBe("NOT_APPLICABLE");
      expect(line.isLocked).toBe(false);
    }
  });

  it("NOT_BUDGETED accounts are left alone (still locked at 0) - only FORMULA is overridden", async () => {
    const notBudgetedCodes = new Set(STAGE2A_ACCOUNTS.filter((a) => a.entryType === "NOT_BUDGETED").map((a) => a.code));
    expect(notBudgetedCodes.size).toBeGreaterThan(0);

    await runStage2ATestSeed(testBypassUser());

    const lines = await prisma.budgetLine.findMany({
      where: { budgetVersion: { isTestData: true } },
      include: { account: true },
    });
    const notBudgetedLines = lines.filter((l) => notBudgetedCodes.has(l.account.code));
    expect(notBudgetedLines.length).toBeGreaterThan(0);
    for (const line of notBudgetedLines) {
      expect(line.entryTypeSnapshot).toBe("NOT_BUDGETED");
      expect(line.isLocked).toBe(true);
    }
  });

  it("the shared Account row's own entryType stays the real FORMULA classification - only the BudgetLine snapshot is overridden", async () => {
    await runStage2ATestSeed(testBypassUser());

    const formulaAccountCodes = STAGE2A_ACCOUNTS.filter((a) => a.entryType === "FORMULA").map((a) => a.code);
    const accounts = await prisma.account.findMany({ where: { code: { in: formulaAccountCodes } } });
    expect(accounts.length).toBe(formulaAccountCodes.length);
    for (const account of accounts) {
      expect(account.entryType).toBe("FORMULA");
    }
  });

  it("a human can type a 2027 amount into a formerly-FORMULA salary/bonus line, and it persists", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    const owner = await createUser({ role: "BUDGET_OWNER" });
    await runStage2ATestSeed(toCurrentUser(admin));

    const dept = await prisma.department.findUniqueOrThrow({ where: { code: "17103" } }); // 資訊處
    await grantDepartmentScope(owner.id, dept.id);
    const version = await prisma.budgetVersion.findFirstOrThrow({ where: { departmentId: dept.id, fiscalYear: STAGE2A_BUDGET_FISCAL_YEAR } });
    const salaryAccount = await prisma.account.findUniqueOrThrow({ where: { code: "6110010" } }); // 薪資支出, FORMULA in the shared master
    const line = await prisma.budgetLine.findUniqueOrThrow({
      where: { budgetVersionId_accountId: { budgetVersionId: version.id, accountId: salaryAccount.id } },
    });
    expect(line.entryTypeSnapshot).toBe("DEPARTMENT_INPUT");

    const updated = await updateDepartmentInputLine(toCurrentUser(owner), version.id, line.id, {
      nextYearTargetExcludingNew: "7200000",
      nextYearNewHireBudget: "500000",
    });
    expect(updated.nextYearTargetExcludingNew.toString()).toBe("7200000");
    expect(updated.nextYearTotal.toString()).toBe("7700000");

    const reread = await prisma.budgetLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(reread.nextYearTargetExcludingNew.toString()).toBe("7200000");
  });

  it("a Stage 2A department can be fully submitted once its formula-turned-editable lines are filled in", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    const owner = await createUser({ role: "BUDGET_OWNER" });
    await runStage2ATestSeed(toCurrentUser(admin));

    const dept = await prisma.department.findUniqueOrThrow({ where: { code: "17103" } });
    await grantDepartmentScope(owner.id, dept.id);
    const version = await prisma.budgetVersion.findFirstOrThrow({ where: { departmentId: dept.id, fiscalYear: STAGE2A_BUDGET_FISCAL_YEAR } });

    // Submission must never be blocked by "尚未設定" - every line on this
    // version is either NOT_BUDGETED (locked at 0, fine) or DEPARTMENT_INPUT
    // (including the formerly-FORMULA ones), so submitting with the seeded
    // defaults (all still 0) must succeed with no formula-related error.
    const submitted = await submitBudgetVersion(toCurrentUser(owner), version.id);
    expect(submitted.status).toBe("SUBMITTED");
  });

  it("does not modify how a REAL department's own createBudgetVersionDraft handles a shared FORMULA account - it still locks behind 尚未設定", async () => {
    await runStage2ATestSeed(testBypassUser()); // seeds the shared M-class accounts, including FORMULA ones like 6110010

    const realDept = await createDepartment({ code: "REALM01", name: "真實管理部門", class: "M" });
    const owner = await createUser({ role: "BUDGET_OWNER" });
    await grantDepartmentScope(owner.id, realDept.id);

    // A real department's own draft, created through the normal (unmodified)
    // production code path - never through runStage2ATestSeed.
    const version = await createBudgetVersionDraft(toCurrentUser(owner), realDept.id, STAGE2A_BUDGET_FISCAL_YEAR);
    const salaryAccount = await prisma.account.findUniqueOrThrow({ where: { code: "6110010" } });
    const line = await prisma.budgetLine.findUniqueOrThrow({
      where: { budgetVersionId_accountId: { budgetVersionId: version.id, accountId: salaryAccount.id } },
    });

    // The real production behavior is unchanged: no FormulaDefinition
    // exists, so this genuinely-FORMULA account is NOT_CONFIGURED/locked,
    // exactly as it always was - the Stage 2A override never touches this path.
    expect(line.entryTypeSnapshot).toBe("FORMULA");
    expect(line.formulaStatus).toBe("NOT_CONFIGURED");
    expect(line.isLocked).toBe(true);

    await expect(
      updateDepartmentInputLine(toCurrentUser(owner), version.id, line.id, {
        nextYearTargetExcludingNew: "1",
        nextYearNewHireBudget: "0",
      })
    ).rejects.toThrow(ApiError);
  });
});

describe("Stage 2A - upgrading an environment seeded before the entryTypeSnapshot fix (e.g. Preview)", () => {
  beforeEach(() => setEnv("preview", "true"));

  it("unlocks an already-existing legacy FORMULA/NOT_CONFIGURED line without discarding real 2027 input, headcount, or a SUBMITTED status", async () => {
    // 財務管理處's own, unrelated manual test data - must survive completely
    // untouched, exactly like every other Stage 2A test.
    const fmoData = await seedFinanceManagementOfficeManualTestData();

    // Hand-build exactly what the OLD (pre-fix) runStage2ATestSeed would
    // have written for 資訊處 (17103) using the SAME deterministic ids the
    // real seed uses, so createMany/skipDuplicates sees them as "already
    // exists" on the next run below - this is what a previously-seeded
    // Preview environment actually looks like on disk.
    const deptId = "stage2a-dept-17103";
    const salaryAccountId = "stage2a-acct-6110010";
    const transitAccountId = "stage2a-acct-6110070";
    const versionId = "stage2a-ver-17103-2027";
    const lockedLineId = "stage2a-line-17103-6110010";
    const editableLineId = "stage2a-line-17103-6110070";
    const untouchedTimestamp = new Date("2026-01-01T00:00:00.000Z");
    const enteredTimestamp = new Date("2026-02-15T09:30:00.000Z");

    await prisma.department.create({
      data: {
        id: deptId,
        code: "17103",
        name: "資訊處",
        class: "M",
        isActive: true,
        isTestData: true,
        priorYearHeadcount: 11,
        priorYearReferenceFiscalYear: STAGE2A_PROJECTION_FISCAL_YEAR,
        createdAt: untouchedTimestamp,
        updatedAt: untouchedTimestamp,
      },
    });
    await prisma.account.create({
      data: {
        id: salaryAccountId,
        code: "6110010",
        name: "薪資支出",
        majorCategory: "M",
        commonCategory: "PERSONNEL",
        entryType: "FORMULA",
        isActive: true,
        createdAt: untouchedTimestamp,
        updatedAt: untouchedTimestamp,
      },
    });
    await prisma.account.create({
      data: {
        id: transitAccountId,
        code: "6110070",
        name: "交通津貼",
        majorCategory: "M",
        commonCategory: "PERSONNEL",
        entryType: "DEPARTMENT_INPUT",
        isActive: true,
        createdAt: untouchedTimestamp,
        updatedAt: untouchedTimestamp,
      },
    });
    await prisma.budgetVersion.create({
      data: {
        id: versionId,
        departmentId: deptId,
        fiscalYear: STAGE2A_BUDGET_FISCAL_YEAR,
        versionNumber: 1,
        status: "SUBMITTED", // already submitted under the old code - must stay SUBMITTED
        isTestData: true,
        priorYearHeadcount: 11,
        budgetYearHeadcount: 11,
        lastPreparedAt: enteredTimestamp,
        createdAt: untouchedTimestamp,
        updatedAt: enteredTimestamp,
      },
    });
    // The old locked FORMULA line - exactly the "尚未設定" state this whole
    // fix targets. Never touched by a user (createdAt === updatedAt), since
    // updateDepartmentInputLine rejects any write while isLocked is true.
    await prisma.budgetLine.create({
      data: {
        id: lockedLineId,
        budgetVersionId: versionId,
        accountId: salaryAccountId,
        priorPriorYearActual: 0,
        priorYearOriginalBudget: 6666200,
        currentYearProjection: 6666200,
        projectionIsComplete: true,
        nextYearTargetExcludingNew: 0,
        nextYearNewHireBudget: 0,
        nextYearTotal: 0,
        entryTypeSnapshot: "FORMULA",
        formulaStatus: "NOT_CONFIGURED",
        isLocked: true,
        justification: null,
        createdAt: untouchedTimestamp,
        updatedAt: untouchedTimestamp,
      },
    });
    // A real, already-editable line the user genuinely filled in and
    // submitted before this fix - must be preserved byte-for-byte.
    await prisma.budgetLine.create({
      data: {
        id: editableLineId,
        budgetVersionId: versionId,
        accountId: transitAccountId,
        priorPriorYearActual: 0,
        priorYearOriginalBudget: 271600,
        currentYearProjection: 271600,
        projectionIsComplete: true,
        nextYearTargetExcludingNew: 300000,
        nextYearNewHireBudget: 20000,
        nextYearTotal: 320000,
        entryTypeSnapshot: "DEPARTMENT_INPUT",
        formulaStatus: "NOT_APPLICABLE",
        isLocked: false,
        justification: "既有真實編列說明，不得被覆蓋",
        createdAt: untouchedTimestamp,
        updatedAt: enteredTimestamp,
      },
    });

    const result = await runStage2ATestSeed(testBypassUser());
    expect(result.budgetLinesUnlocked).toBeGreaterThanOrEqual(1);

    const unlockedLine = await prisma.budgetLine.findUniqueOrThrow({ where: { id: lockedLineId } });
    expect(unlockedLine.entryTypeSnapshot).toBe("DEPARTMENT_INPUT");
    expect(unlockedLine.formulaStatus).toBe("NOT_APPLICABLE");
    expect(unlockedLine.isLocked).toBe(false);
    // Still "never touched by a user" - the raw SQL upgrade must not bump
    // updatedAt, or this line would wrongly show a fabricated 2027 amount
    // instead of "—" in the summary (see lineIsTouched in
    // multiDepartmentSummary.ts / isUntouched in BudgetVersionClient.tsx).
    expect(unlockedLine.updatedAt.getTime()).toBe(unlockedLine.createdAt.getTime());
    expect(unlockedLine.updatedAt.getTime()).toBe(untouchedTimestamp.getTime());

    const preservedLine = await prisma.budgetLine.findUniqueOrThrow({ where: { id: editableLineId } });
    expect(preservedLine.nextYearTargetExcludingNew.toString()).toBe("300000");
    expect(preservedLine.nextYearNewHireBudget.toString()).toBe("20000");
    expect(preservedLine.nextYearTotal.toString()).toBe("320000");
    expect(preservedLine.justification).toBe("既有真實編列說明，不得被覆蓋");
    expect(preservedLine.updatedAt.getTime()).toBe(enteredTimestamp.getTime());

    const preservedVersion = await prisma.budgetVersion.findUniqueOrThrow({ where: { id: versionId } });
    expect(preservedVersion.status).toBe("SUBMITTED"); // never reverted to DRAFT
    expect(preservedVersion.priorYearHeadcount).toBe(11);
    expect(preservedVersion.budgetYearHeadcount).toBe(11);

    const preservedDept = await prisma.department.findUniqueOrThrow({ where: { id: deptId } });
    expect(preservedDept.priorYearHeadcount).toBe(11);

    // 財務管理處's own, unrelated data is completely untouched.
    const fmoLineAfter = await prisma.budgetLine.findUniqueOrThrow({ where: { id: fmoData.line.id } });
    expect(fmoLineAfter.nextYearTargetExcludingNew.toString()).toBe("999999");
    expect(fmoLineAfter.entryTypeSnapshot).toBe("DEPARTMENT_INPUT");
    const fmoVersionAfter = await prisma.budgetVersion.findUniqueOrThrow({ where: { id: fmoData.version.id } });
    expect(fmoVersionAfter.status).toBe("DRAFT");
  });

  it("re-running the seed again after the upgrade is a true no-op for the already-unlocked line (idempotent)", async () => {
    const deptId = "stage2a-dept-17103";
    const versionId = "stage2a-ver-17103-2027";
    const lockedLineId = "stage2a-line-17103-6110010";
    const untouchedTimestamp = new Date("2026-01-01T00:00:00.000Z");

    await prisma.department.create({
      data: {
        id: deptId,
        code: "17103",
        name: "資訊處",
        class: "M",
        isActive: true,
        isTestData: true,
        priorYearHeadcount: 11,
        priorYearReferenceFiscalYear: STAGE2A_PROJECTION_FISCAL_YEAR,
        createdAt: untouchedTimestamp,
        updatedAt: untouchedTimestamp,
      },
    });
    await prisma.account.create({
      data: {
        id: "stage2a-acct-6110010",
        code: "6110010",
        name: "薪資支出",
        majorCategory: "M",
        commonCategory: "PERSONNEL",
        entryType: "FORMULA",
        isActive: true,
        createdAt: untouchedTimestamp,
        updatedAt: untouchedTimestamp,
      },
    });
    await prisma.budgetVersion.create({
      data: {
        id: versionId,
        departmentId: deptId,
        fiscalYear: STAGE2A_BUDGET_FISCAL_YEAR,
        versionNumber: 1,
        status: "DRAFT",
        isTestData: true,
        priorYearHeadcount: 11,
        budgetYearHeadcount: 11,
        lastPreparedAt: untouchedTimestamp,
        createdAt: untouchedTimestamp,
        updatedAt: untouchedTimestamp,
      },
    });
    await prisma.budgetLine.create({
      data: {
        id: lockedLineId,
        budgetVersionId: versionId,
        accountId: "stage2a-acct-6110010",
        priorPriorYearActual: 0,
        priorYearOriginalBudget: 6666200,
        currentYearProjection: 6666200,
        projectionIsComplete: true,
        nextYearTargetExcludingNew: 0,
        nextYearNewHireBudget: 0,
        nextYearTotal: 0,
        entryTypeSnapshot: "FORMULA",
        formulaStatus: "NOT_CONFIGURED",
        isLocked: true,
        justification: null,
        createdAt: untouchedTimestamp,
        updatedAt: untouchedTimestamp,
      },
    });

    const firstRun = await runStage2ATestSeed(testBypassUser());
    expect(firstRun.budgetLinesUnlocked).toBeGreaterThanOrEqual(1);
    const afterFirst = await prisma.budgetLine.findUniqueOrThrow({ where: { id: lockedLineId } });
    expect(afterFirst.entryTypeSnapshot).toBe("DEPARTMENT_INPUT");

    const secondRun = await runStage2ATestSeed(testBypassUser());
    expect(secondRun.budgetLinesUnlocked).toBe(0); // nothing left in the old locked state to fix
    const afterSecond = await prisma.budgetLine.findUniqueOrThrow({ where: { id: lockedLineId } });
    expect(afterSecond.updatedAt.getTime()).toBe(untouchedTimestamp.getTime());
  });
});
