import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resetDatabase } from "./helpers/reset";
import { createUser, toCurrentUser } from "./helpers/factory";
import { prisma } from "@/lib/prisma";
import { runStage2ATestSeed, STAGE2A_PROJECTION_FISCAL_YEAR, STAGE2A_BUDGET_FISCAL_YEAR } from "@/lib/testdata/stage2aSeed";
import { STAGE2A_DEPARTMENTS } from "@/lib/testdata/stage2aDepartments";
import { STAGE2A_ACCOUNTS } from "@/lib/testdata/stage2aAccounts";
import { isPreviewStressSeedEnvironment } from "@/lib/env";

beforeEach(async () => {
  await resetDatabase();
});

async function seedFinanceManagementOffice() {
  // Mirrors the pre-existing manual test data the Stage 2A seed must never
  // touch: 財務管理處 (17203), some management accounts, and a submitted
  // budget line.
  const fmo = await prisma.department.create({ data: { code: "17203", name: "財務管理處", class: "M" } });
  const account = await prisma.account.create({
    data: { code: "6110010", name: "薪資支出", majorCategory: "M", commonCategory: "PERSONNEL", entryType: "DEPARTMENT_INPUT" },
  });
  const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
  const version = await prisma.budgetVersion.create({
    data: { departmentId: fmo.id, fiscalYear: 2027, versionNumber: 1, status: "DRAFT", preparedById: admin.id },
  });
  const line = await prisma.budgetLine.create({
    data: {
      budgetVersionId: version.id,
      accountId: account.id,
      priorPriorYearActual: 111,
      priorYearOriginalBudget: 222,
      currentYearProjection: 333,
      projectionIsComplete: true,
      nextYearTargetExcludingNew: 0,
      nextYearNewHireBudget: 0,
      nextYearTotal: 0,
      entryTypeSnapshot: "DEPARTMENT_INPUT",
      isLocked: false,
    },
  });
  return { fmo, account, version, line, admin };
}

describe("Stage 2A test-data seed", () => {
  it("creates exactly 8 departments, 2 per class, with the overseas site classified S", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    const result = await runStage2ATestSeed(toCurrentUser(admin));

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

    const departmentsInDb = await prisma.department.findMany({ where: { isTestData: true } });
    expect(departmentsInDb).toHaveLength(8);
  });

  it("is idempotent: running twice creates no duplicate departments, accounts, headcount rows, or budget lines", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    const first = await runStage2ATestSeed(toCurrentUser(admin));
    const second = await runStage2ATestSeed(toCurrentUser(admin));

    expect(second.departmentsCreated).toBe(0);
    expect(second.accountsCreated).toBe(0);
    expect(second.headcountRowsCreated).toBe(0);
    expect(second.budgetVersionsCreated).toBe(0);
    expect(second.budgetLinesCreated).toBe(0);

    expect(await prisma.department.count({ where: { isTestData: true } })).toBe(8);
    expect(await prisma.account.count()).toBe(STAGE2A_ACCOUNTS.length);
    expect(await prisma.departmentHeadcount.count()).toBe(8);
    expect(await prisma.budgetVersion.count({ where: { isTestData: true } })).toBe(8);
    expect(first.budgetLinesCreated).toBeGreaterThan(0);
  });

  it("never touches 財務管理處's existing department, account, budget version, or line data", async () => {
    const { fmo, account, version, line } = await seedFinanceManagementOffice();
    const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });

    await runStage2ATestSeed(toCurrentUser(admin));

    const fmoAfter = await prisma.department.findUnique({ where: { id: fmo.id } });
    expect(fmoAfter).toMatchObject({ code: "17203", name: "財務管理處", class: "M", isTestData: false });

    const accountAfter = await prisma.account.findUnique({ where: { id: account.id } });
    expect(accountAfter?.name).toBe("薪資支出");

    const versionAfter = await prisma.budgetVersion.findUnique({ where: { id: version.id } });
    expect(versionAfter?.status).toBe("DRAFT");
    expect(versionAfter?.isTestData).toBe(false);

    const lineAfter = await prisma.budgetLine.findUnique({ where: { id: line.id } });
    expect(lineAfter?.currentYearProjection?.toString()).toBe("333");
    expect(lineAfter?.priorPriorYearActual.toString()).toBe("111");

    // FMO's department/account/version/line rows must be the only ones NOT
    // flagged as test data.
    expect(await prisma.department.count({ where: { isTestData: false } })).toBe(1);
  });

  it("only materializes accounts applicable to each department's own class", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    const result = await runStage2ATestSeed(toCurrentUser(admin));

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

  it("keeps 2026 projections isolated per department+account: same account code, different departments, independent amounts", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    await runStage2ATestSeed(toCurrentUser(admin));

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

    // Mutating one department's line must never affect the other's - this is
    // the whole point of keying projections by (departmentId, accountId,
    // fiscalYear) via BudgetVersion+BudgetLine rather than a shared column.
    await prisma.budgetLine.update({ where: { id: lineA.id }, data: { currentYearProjection: 999999 } });
    const lineBAfter = await prisma.budgetLine.findUniqueOrThrow({ where: { id: lineB.id } });
    expect(lineBAfter.currentYearProjection?.toNumber()).toBe(lineB.currentYearProjection?.toNumber());
    expect(lineBAfter.currentYearProjection?.toNumber()).not.toBe(999999);
  });

  it("leaves every 2027 figure blank (zero, editable) and the version status DRAFT only", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    await runStage2ATestSeed(toCurrentUser(admin));

    const versions = await prisma.budgetVersion.findMany({
      where: { isTestData: true },
      include: { lines: true },
    });
    expect(versions).toHaveLength(8);
    for (const v of versions) {
      expect(v.status).toBe("DRAFT");
      expect(v.fiscalYear).toBe(STAGE2A_BUDGET_FISCAL_YEAR);
      for (const line of v.lines) {
        expect(line.nextYearTargetExcludingNew.toNumber()).toBe(0);
        expect(line.nextYearNewHireBudget.toNumber()).toBe(0);
        expect(line.nextYearTotal.toNumber()).toBe(0);
        expect(line.growthRateExcludingNew).toBeNull();
        expect(line.growthRateIncludingNew).toBeNull();
      }
    }

    const headcounts = await prisma.departmentHeadcount.findMany();
    expect(headcounts.every((h) => h.fiscalYear === STAGE2A_PROJECTION_FISCAL_YEAR)).toBe(true);
  });

  it("produces per-department 2026 projection totals that equal the sum of that department's own line items", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    const result = await runStage2ATestSeed(toCurrentUser(admin));

    for (const dept of result.departments) {
      const dbDept = await prisma.department.findUniqueOrThrow({ where: { code: dept.code } });
      const version = await prisma.budgetVersion.findFirstOrThrow({
        where: { departmentId: dbDept.id, fiscalYear: STAGE2A_BUDGET_FISCAL_YEAR },
        include: { lines: true },
      });
      const sum = version.lines.reduce((acc, l) => acc + (l.currentYearProjection?.toNumber() ?? 0), 0);
      expect(sum).toBe(Number(dept.totalProjection2026));
    }
  });

  it("gives every department non-zero and non-uniform 2026 amounts, and a production department's total clearly exceeds a management department's", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    const result = await runStage2ATestSeed(toCurrentUser(admin));

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
    // headcount ranges per class, per the Stage 2A spec
    expect(Math.min(...(totalsByClass.get("M") ?? []))).toBeGreaterThan(0);
    const maxM = Math.max(...(totalsByClass.get("M") ?? []));
    const minP = Math.min(...(totalsByClass.get("P") ?? []));
    expect(minP).toBeGreaterThan(maxM);

    const amounts = result.departments.map((d) => Number(d.totalProjection2026));
    expect(new Set(amounts).size).toBeGreaterThan(1);
  });

  it("re-running the deterministic seed after a fresh reset reproduces byte-identical totals (fixed rule, not random)", async () => {
    const admin1 = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    const first = await runStage2ATestSeed(toCurrentUser(admin1));

    await resetDatabase();

    const admin2 = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    const second = await runStage2ATestSeed(toCurrentUser(admin2));

    const totalsFirst = first.departments.map((d) => `${d.code}:${d.totalProjection2026}:${d.headcount2026}`).sort();
    const totalsSecond = second.departments.map((d) => `${d.code}:${d.totalProjection2026}:${d.headcount2026}`).sort();
    expect(totalsSecond).toEqual(totalsFirst);
  });

  it("writes a single AuditLog entry naming the actor and the 8-department scope", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    await runStage2ATestSeed(toCurrentUser(admin));

    const logs = await prisma.auditLog.findMany({ where: { action: "STAGE2A_STRESS_SEED" } });
    expect(logs).toHaveLength(1);
    const log = logs[0]!;
    expect(log.actorUserId).toBe(admin.id);
    const after = log.afterData as { departmentCodes: string[] };
    expect(after.departmentCodes).toHaveLength(8);
  });
});

describe("Stage 2A preview environment gate", () => {
  const originalVercelEnv = process.env.VERCEL_ENV;
  const originalAuthDisabled = process.env.AUTH_DISABLED;

  it("is false unless both VERCEL_ENV=preview and AUTH_DISABLED=true are set", () => {
    delete process.env.VERCEL_ENV;
    delete process.env.AUTH_DISABLED;
    expect(isPreviewStressSeedEnvironment()).toBe(false);

    process.env.VERCEL_ENV = "production";
    process.env.AUTH_DISABLED = "true";
    expect(isPreviewStressSeedEnvironment()).toBe(false);

    process.env.VERCEL_ENV = "preview";
    process.env.AUTH_DISABLED = "false";
    expect(isPreviewStressSeedEnvironment()).toBe(false);

    process.env.VERCEL_ENV = "preview";
    process.env.AUTH_DISABLED = "true";
    expect(isPreviewStressSeedEnvironment()).toBe(true);

    process.env.VERCEL_ENV = originalVercelEnv;
    process.env.AUTH_DISABLED = originalAuthDisabled;
  });

  it("the stress-seed route checks the environment gate before doing anything else", () => {
    const routeFile = path.join(__dirname, "..", "src", "app", "api", "demo", "stress-seed", "route.ts");
    const source = fs.readFileSync(routeFile, "utf-8");
    const gateIndex = source.indexOf("isPreviewStressSeedEnvironment()");
    const seedCallIndex = source.indexOf("runStage2ATestSeed(");
    expect(gateIndex).toBeGreaterThan(-1);
    expect(seedCallIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(seedCallIndex);
  });
});
