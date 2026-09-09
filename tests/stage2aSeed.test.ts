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
