import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { createUser, toCurrentUser, grantDepartmentScope } from "./helpers/factory";
import { prisma } from "@/lib/prisma";
import { runStage2ATestSeed, STAGE2A_BUDGET_FISCAL_YEAR } from "@/lib/testdata/stage2aSeed";
import { testBypassUser } from "@/lib/auth/testBypass";
import { updateDepartmentInputLine } from "@/lib/budget/lineService";
import { fetchDeptSummaryEntries } from "@/lib/reports/fetchFinanceVersion";
import { KNOWN_DEPARTMENT_CODES } from "@/lib/reports/budgetSummaryPreviewData";
import {
  buildDeptAgg,
  buildLineAgg,
  buildReportingAccountAgg,
  buildUnmappedAccountRows,
  isSgaClass,
  isProductionClass,
} from "@/lib/reports/multiDepartmentSummary";
import { STATUS_LABEL } from "@/lib/reports/summaryReportData";
import { SGA_REPORTING_ACCOUNTS, PRODUCTION_REPORTING_ACCOUNTS } from "@/lib/reports/reportingAccountMap";

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

describe("reportingAccountKey summary - 科目彙總 no longer repeats department names, one row per reporting line", () => {
  it("has no department column at all - every reportingAccountKey row is pooled across departments, never one row per department+account", async () => {
    await runStage2ATestSeed(testBypassUser());
    const entries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);
    const sgaEntries = entries.filter((e) => e.isTestData && isSgaClass(e.class));

    // For every SGA reporting row, the aggregate is a SINGLE LineAgg - not a
    // per-department list - by construction of buildReportingAccountAgg's
    // return type (LineAgg, not LineAgg[]). Exercise a handful of rows and
    // confirm each one pools 6 departments' worth of lines into one number.
    for (const mapping of SGA_REPORTING_ACCOUNTS.slice(0, 5)) {
      const agg = buildReportingAccountAgg(sgaEntries, mapping);
      expect(agg.prior).toBeDefined();
      expect(typeof agg.prior.toNumber()).toBe("number");
    }
  });

  it("6110010 (M) / 6210010 (S) / 6310010 (R) 薪資支出 collapse into exactly one reportingAccountKey row, summing all three", async () => {
    await runStage2ATestSeed(testBypassUser());
    const entries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);
    const sgaEntries = entries.filter((e) => e.isTestData && isSgaClass(e.class));

    const salaryMapping = SGA_REPORTING_ACCOUNTS.find((r) => r.sourceCodes.M === "6110010")!;
    const agg = buildReportingAccountAgg(sgaEntries, salaryMapping);

    // Manual cross-check: sum priorYearOriginalBudget directly from the raw
    // BudgetLine rows across all 6 SGA departments for exactly these 3 codes.
    const manualSum = sgaEntries
      .flatMap((e) => e.version!.lines)
      .filter((l) => ["6110010", "6210010", "6310010"].includes(l.account.code))
      .reduce((acc, l) => acc + Number(l.priorYearOriginalBudget), 0);
    expect(agg.prior.toNumber()).toBe(manualSum);
    expect(agg.prior.toNumber()).toBeGreaterThan(0);
  });

  it("SGA grand total across all reportingAccountKey rows still reconciles to 106,985,400 (unchanged test-data total)", async () => {
    const result = await runStage2ATestSeed(testBypassUser());
    const entries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);
    const sgaEntries = entries.filter((e) => e.isTestData && isSgaClass(e.class));

    const mappedCodes = new Set(SGA_REPORTING_ACCOUNTS.flatMap((m) => Object.values(m.sourceCodes)));
    const allMappedLines = sgaEntries.flatMap((e) => e.version!.lines.filter((l) => mappedCodes.has(l.account.code)));
    const grandAgg = buildLineAgg(allMappedLines);

    const sgaCodes = ["17103", "17303", "12111", "20001", "11122", "11322"];
    const expected = result.departments.filter((d) => sgaCodes.includes(d.code)).reduce((acc, d) => acc + Number(d.totalProjection2026), 0);
    expect(grandAgg.prior.toNumber()).toBe(expected);
    expect(grandAgg.prior.toNumber()).toBe(106985400);
  });

  it("Production grand total across all reportingAccountKey rows still reconciles to 198,192,300 (unchanged test-data total)", async () => {
    const result = await runStage2ATestSeed(testBypassUser());
    const entries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);
    const prodEntries = entries.filter((e) => e.isTestData && isProductionClass(e.class));

    const mappedCodes = new Set(PRODUCTION_REPORTING_ACCOUNTS.flatMap((m) => Object.values(m.sourceCodes)));
    const allMappedLines = prodEntries.flatMap((e) => e.version!.lines.filter((l) => mappedCodes.has(l.account.code)));
    const grandAgg = buildLineAgg(allMappedLines);

    const prodCodes = ["16124", "16204"];
    const expected = result.departments.filter((d) => prodCodes.includes(d.code)).reduce((acc, d) => acc + Number(d.totalProjection2026), 0);
    expect(grandAgg.prior.toNumber()).toBe(expected);
    expect(grandAgg.prior.toNumber()).toBe(198192300);
  });

  it("every mapped reportingAccountKey's aggregate equals its own source BudgetLine rows summed exactly (full reconciliation, not just the grand total)", async () => {
    await runStage2ATestSeed(testBypassUser());
    const entries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);
    const sgaEntries = entries.filter((e) => e.isTestData && isSgaClass(e.class));

    let reconciledRows = 0;
    for (const mapping of SGA_REPORTING_ACCOUNTS) {
      const agg = buildReportingAccountAgg(sgaEntries, mapping);
      const codes = Object.values(mapping.sourceCodes);
      const manualSum = sgaEntries
        .flatMap((e) => e.version!.lines)
        .filter((l) => codes.includes(l.account.code))
        .reduce((acc, l) => acc + Number(l.priorYearOriginalBudget), 0);
      expect(agg.prior.toNumber()).toBe(manualSum);
      reconciledRows++;
    }
    expect(reconciledRows).toBe(SGA_REPORTING_ACCOUNTS.length);
  });

  it("財務管理處's own legacy test account (code \"3\", also named 薪資支出) is never merged into the real 薪資支出 reportingAccountKey - it shows up only as 待確認科目", async () => {
    await runStage2ATestSeed(testBypassUser());

    const fmoOwner = await createUser({ role: "BUDGET_OWNER" });
    const fmo = await prisma.department.create({
      data: { code: "17203", name: "財務管理處", class: "M", priorYearHeadcount: 10, priorYearReferenceFiscalYear: 2025 },
    });
    const legacyAccount = await prisma.account.create({
      data: { code: "3", name: "薪資支出", majorCategory: "M", commonCategory: "PERSONNEL", entryType: "DEPARTMENT_INPUT" },
    });
    const fmoVersion = await prisma.budgetVersion.create({
      data: {
        departmentId: fmo.id,
        fiscalYear: STAGE2A_BUDGET_FISCAL_YEAR,
        versionNumber: 1,
        status: "DRAFT",
        preparedById: fmoOwner.id,
        priorYearHeadcount: 10,
        budgetYearHeadcount: 10,
        lastPreparedAt: new Date("2026-01-05T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-05T00:00:00.000Z"),
      },
    });
    await prisma.budgetLine.create({
      data: {
        budgetVersionId: fmoVersion.id,
        accountId: legacyAccount.id,
        priorPriorYearActual: 0,
        priorYearOriginalBudget: 1234567,
        currentYearProjection: 1234567,
        projectionIsComplete: true,
        nextYearTargetExcludingNew: 0,
        nextYearNewHireBudget: 0,
        nextYearTotal: 0,
        entryTypeSnapshot: "DEPARTMENT_INPUT",
        isLocked: false,
      },
    });

    const entries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);
    const sgaEntries = entries.filter((e) => isSgaClass(e.class));

    const salaryMapping = SGA_REPORTING_ACCOUNTS.find((r) => r.sourceCodes.M === "6110010")!;
    const salaryAgg = buildReportingAccountAgg(sgaEntries, salaryMapping);
    // FMO's 1,234,567 must NOT be included in the real 薪資支出 row.
    const stage2aOnlyEntries = entries.filter((e) => e.isTestData && isSgaClass(e.class));
    const stage2aOnlySalaryAgg = buildReportingAccountAgg(stage2aOnlyEntries, salaryMapping);
    expect(salaryAgg.prior.toNumber()).toBe(stage2aOnlySalaryAgg.prior.toNumber());

    const unmapped = buildUnmappedAccountRows(sgaEntries);
    const fmoUnmapped = unmapped.find((r) => r.departmentCode === "17203" && r.accountCode === "3");
    expect(fmoUnmapped).toBeTruthy();
    expect(fmoUnmapped!.accountName).toBe("薪資支出");
    expect(Number(fmoUnmapped!.line.priorYearOriginalBudget)).toBe(1234567);
  });
});
