import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { createUser, toCurrentUser, grantDepartmentScope } from "./helpers/factory";
import { prisma } from "@/lib/prisma";
import { runStage2ATestSeed, STAGE2A_BUDGET_FISCAL_YEAR } from "@/lib/testdata/stage2aSeed";
import { testBypassUser } from "@/lib/auth/testBypass";
import { updateDepartmentInputLine } from "@/lib/budget/lineService";
import { fetchDeptSummaryEntries } from "@/lib/reports/fetchFinanceVersion";
import { KNOWN_DEPARTMENT_CODES } from "@/lib/reports/budgetSummaryPreviewData";
import { buildDeptAgg, buildLineAgg, isSgaClass, isProductionClass } from "@/lib/reports/multiDepartmentSummary";
import { STATUS_LABEL } from "@/lib/reports/summaryReportData";

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
  setEnv("preview", "true");
});

describe("fetchDeptSummaryEntries - multi-department summary root cause fix", () => {
  it("returns all 8 Stage 2A departments once seeded, each with a real fiscalYear=2027 version", async () => {
    await runStage2ATestSeed(testBypassUser());
    const entries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);

    const stage2aEntries = entries.filter((e) => e.isTestData);
    expect(stage2aEntries).toHaveLength(8);
    for (const e of stage2aEntries) {
      expect(e.version).not.toBeNull();
      expect(e.version!.status).toBe("DRAFT");
    }
  });

  it("2026 推估 shows for every department immediately, before any 2027 amount is entered", async () => {
    await runStage2ATestSeed(testBypassUser());
    const entries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);

    for (const e of entries.filter((x) => x.isTestData)) {
      const agg = buildDeptAgg(e.version)!;
      expect(agg.priorTotal.toNumber()).toBeGreaterThan(0);
      // Nothing entered yet -> 2027 is "—" (null), never fabricated 0.
      expect(agg.excludingNewTotal).toBeNull();
      expect(agg.grandTotal).toBeNull();
    }
  });

  it("once a real user enters a DRAFT 2027 amount, the preview shows it immediately labeled 草稿", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    const owner = await createUser({ role: "BUDGET_OWNER" });
    await runStage2ATestSeed(toCurrentUser(admin));

    const dept = await prisma.department.findUniqueOrThrow({ where: { code: "12111" } }); // 台北
    await grantDepartmentScope(owner.id, dept.id);
    const version = await prisma.budgetVersion.findFirstOrThrow({
      where: { departmentId: dept.id, fiscalYear: STAGE2A_BUDGET_FISCAL_YEAR },
      include: { lines: true },
    });
    const line = version.lines[0]!;
    await updateDepartmentInputLine(toCurrentUser(owner), version.id, line.id, {
      nextYearTargetExcludingNew: "300000",
      nextYearNewHireBudget: "0",
    });

    const entries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);
    const taipei = entries.find((e) => e.code === "12111")!;
    expect(taipei.version!.status).toBe("DRAFT");
    expect(STATUS_LABEL[taipei.version!.status]).toBe("草稿");
    const agg = buildDeptAgg(taipei.version)!;
    expect(agg.excludingNewTotal?.toNumber()).toBe(300000);
  });

  it("SGA scope includes S/M/R Stage 2A departments and excludes both production departments", async () => {
    await runStage2ATestSeed(testBypassUser());
    const entries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);
    const stage2aEntries = entries.filter((e) => e.isTestData);

    const sgaCodes = stage2aEntries.filter((e) => isSgaClass(e.class)).map((e) => e.code);
    const productionCodes = stage2aEntries.filter((e) => isProductionClass(e.class)).map((e) => e.code);

    expect(sgaCodes.sort()).toEqual(["11122", "11322", "12111", "17103", "17303", "20001"].sort());
    expect(productionCodes.sort()).toEqual(["16124", "16204"].sort());
    // Disjoint.
    expect(sgaCodes.some((c) => productionCodes.includes(c))).toBe(false);
  });

  it("each department's aggregate 2026 total equals the sum of its own BudgetLine rows", async () => {
    const result = await runStage2ATestSeed(testBypassUser());
    const entries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);

    for (const summary of result.departments) {
      const entry = entries.find((e) => e.code === summary.code)!;
      const agg = buildDeptAgg(entry.version)!;
      expect(agg.priorTotal.toNumber()).toBe(Number(summary.totalProjection2026));

      const manualSum = entry.version!.lines.reduce((acc, l) => acc + Number(l.priorYearOriginalBudget), 0);
      expect(agg.priorTotal.toNumber()).toBe(manualSum);
    }
  });

  it("pooling the SGA departments' lines gives a 2026 total equal to the sum of their individual dept totals", async () => {
    const result = await runStage2ATestSeed(testBypassUser());
    const entries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);
    const sgaEntries = entries.filter((e) => e.isTestData && isSgaClass(e.class));

    const pooled = buildLineAgg(sgaEntries.flatMap((e) => e.version!.lines));
    const expected = result.departments
      .filter((d) => sgaEntries.some((e) => e.code === d.code))
      .reduce((acc, d) => acc + Number(d.totalProjection2026), 0);
    expect(pooled.prior.toNumber()).toBe(expected);
  });

  it("never touches or reflects a change to 財務管理處's existing data", async () => {
    const fmoOwner = await createUser({ role: "BUDGET_OWNER" });
    const fmo = await prisma.department.create({
      data: { code: "17203", name: "財務管理處", class: "M", priorYearHeadcount: 10, priorYearReferenceFiscalYear: 2025 },
    });
    const account = await prisma.account.create({
      data: { code: "3", name: "薪資支出", majorCategory: "M", commonCategory: "PERSONNEL", entryType: "DEPARTMENT_INPUT" },
    });
    // createdAt and lastPreparedAt are set explicitly (and far apart) rather
    // than left to resolve near-simultaneous default `now()` values - this
    // version must unambiguously "have budget input" per
    // versionHasBudgetInput (lastPreparedAt !== createdAt), matching how a
    // real submitted version's content was actually edited well after its
    // draft was first created (see createBudgetVersionDraft/
    // updateDepartmentInputLine).
    const fmoVersion = await prisma.budgetVersion.create({
      data: {
        departmentId: fmo.id,
        fiscalYear: STAGE2A_BUDGET_FISCAL_YEAR,
        versionNumber: 1,
        status: "SUBMITTED",
        preparedById: fmoOwner.id,
        priorYearHeadcount: 10,
        budgetYearHeadcount: 10,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-05T00:00:00.000Z"),
        lastPreparedAt: new Date("2026-01-05T00:00:00.000Z"),
      },
    });
    await prisma.budgetLine.create({
      data: {
        budgetVersionId: fmoVersion.id,
        accountId: account.id,
        priorPriorYearActual: 0,
        priorYearOriginalBudget: 1234567,
        currentYearProjection: 1234567,
        projectionIsComplete: true,
        nextYearTargetExcludingNew: 9999999,
        nextYearNewHireBudget: 0,
        nextYearTotal: 9999999,
        entryTypeSnapshot: "DEPARTMENT_INPUT",
        isLocked: false,
      },
    });

    await runStage2ATestSeed(testBypassUser());

    const entries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);
    const fmoEntry = entries.find((e) => e.code === "17203")!;
    expect(fmoEntry.isTestData).toBe(false);
    expect(fmoEntry.version!.status).toBe("SUBMITTED");
    const agg = buildDeptAgg(fmoEntry.version)!;
    expect(agg.priorTotal.toNumber()).toBe(1234567);
    expect(agg.grandTotal?.toNumber()).toBe(9999999);

    const fmoAfter = await prisma.department.findUniqueOrThrow({ where: { id: fmo.id } });
    expect(fmoAfter.name).toBe("財務管理處");
    const lineAfter = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: fmoVersion.id } });
    expect(lineAfter.nextYearTargetExcludingNew.toString()).toBe("9999999");
  });
});
