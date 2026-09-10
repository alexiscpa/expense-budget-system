import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { seedDemoMasterData, getDemoSeedStatus } from "@/lib/demo/seedDemoMasterData";
import {
  DEMO_DEPARTMENT_CODE,
  DEMO_DEPARTMENT_CLASS,
  DEMO_ACCOUNTS,
  DEMO_ACCOUNT_COUNT,
  DEMO_FISCAL_YEAR,
  LEGACY_DEMO_DEPARTMENT_CODE,
  LEGACY_DEMO_ACCOUNT_CODES,
} from "@/lib/demo/constants";
import { createBudgetVersionDraft, updateDepartmentInputLine } from "@/lib/budget/lineService";
import { computeCategorySummary } from "@/lib/budget/categorySummary";
import { submitBudgetVersion, startReview } from "@/lib/workflow/actions";
import { seedOfficialAccountsFor17203 } from "./helpers/demoOfficialAccounts";
import { testBypassUser, TEST_BYPASS_USER_ID } from "@/lib/auth/testBypass";
import { ApiError } from "@/lib/rbac/guard";
import { prisma } from "@/lib/prisma";
import { sumDecimals } from "@/lib/money/decimal";

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

// Independently cross-checked against the source spreadsheet
// (2026年度費用預算V2--財務.xlsx／財務工作表) F 欄「2025推移」 subtotal cells:
// 人事費用=11186397, 銷管費用=2379612, 辦公費用=9319760, 其他費用=-709704,
// 管理費用(grand total)=22176065.
const EXPECTED_CATEGORY_TOTALS: Record<string, string> = {
  PERSONNEL: "11186397",
  SG_AND_A: "2379612",
  OFFICE: "9319760",
  OTHER: "-709704",
};
const EXPECTED_GRAND_TOTAL = "22176065";

describe("seedDemoMasterData / getDemoSeedStatus - fail-closed environment gating", () => {
  it("refuses to run in Production even with AUTH_DISABLED=true, and creates nothing", async () => {
    setEnv("production", "true");
    await expect(seedDemoMasterData(TEST_BYPASS_USER_ID)).rejects.toThrow(ApiError);
    const dept = await prisma.department.findUnique({ where: { code: DEMO_DEPARTMENT_CODE } });
    expect(dept).toBeNull();
  });

  it("refuses to run in Preview when AUTH_DISABLED is not exactly 'true'", async () => {
    setEnv("preview", "false");
    await expect(seedDemoMasterData(TEST_BYPASS_USER_ID)).rejects.toThrow(ApiError);
    setEnv("preview", undefined);
    await expect(seedDemoMasterData(TEST_BYPASS_USER_ID)).rejects.toThrow(ApiError);
    const dept = await prisma.department.findUnique({ where: { code: DEMO_DEPARTMENT_CODE } });
    expect(dept).toBeNull();
  });

  it("refuses to run outside Vercel entirely (VERCEL_ENV unset), even with AUTH_DISABLED=true", async () => {
    setEnv(undefined, "true");
    await expect(seedDemoMasterData(TEST_BYPASS_USER_ID)).rejects.toThrow(ApiError);
  });

  it("getDemoSeedStatus is gated the same way as seedDemoMasterData", async () => {
    setEnv("production", "true");
    await expect(getDemoSeedStatus()).rejects.toThrow(ApiError);
  });
});

describe("seedDemoMasterData - real 財務管理處 (17203) master data, 62 detail accounts", () => {
  it("creates exactly one 17203 department and 62 detail accounts, with no budget amounts", async () => {
    setEnv("preview", "true");
    const result = await seedDemoMasterData(TEST_BYPASS_USER_ID);

    expect(result.department.code).toBe(DEMO_DEPARTMENT_CODE);
    expect(result.department.name).toBe("財務管理處");
    expect(result.accountCount).toBe(DEMO_ACCOUNT_COUNT);
    expect(result.accounts).toHaveLength(62);
    expect(result.fiscalYear).toBe(DEMO_FISCAL_YEAR);
    expect(result.fiscalYear).toBe(2026);

    expect(await prisma.department.count({ where: { code: DEMO_DEPARTMENT_CODE } })).toBe(1);
    expect(await prisma.account.count({ where: { sourceSeq: { in: DEMO_ACCOUNTS.map((a) => a.seq) } } })).toBe(62);
    // No duplicate codes.
    expect(new Set(result.accounts.map((a) => a.code)).size).toBe(62);
    // No budget amounts/lines are ever pre-created - those must be entered by hand.
    expect(await prisma.budgetVersion.count()).toBe(0);
    expect(await prisma.budgetLine.count()).toBe(0);
  });

  it("assigns every account its real code from the source Excel A欄「序號」(no FIN- prefix, no provisional marker)", async () => {
    setEnv("preview", "true");
    await seedDemoMasterData(TEST_BYPASS_USER_ID);
    const accounts = await prisma.account.findMany({ where: { sourceSeq: { in: DEMO_ACCOUNTS.map((a) => a.seq) } } });
    expect(accounts).toHaveLength(62);
    for (const a of accounts) {
      expect(a.isProvisionalCode).toBe(false);
      expect(a.sourceSeq).not.toBeNull();
      expect(a.code).toBe(String(a.sourceSeq));
      expect(a.code.startsWith("FIN-")).toBe(false);
      expect(a.sourceRef).toContain("2026年度費用預算V2--財務.xlsx");
      expect(a.sourceRef).toContain(`序${a.sourceSeq}`);
    }
  });

  it("classifies every account into exactly the documented four categories, matching the given row ranges", async () => {
    setEnv("preview", "true");
    await seedDemoMasterData(TEST_BYPASS_USER_ID);
    const accounts = await prisma.account.findMany({
      where: { sourceSeq: { in: DEMO_ACCOUNTS.map((a) => a.seq) } },
      orderBy: { sourceSeq: "asc" },
    });

    const byCategory = { PERSONNEL: 0, SG_AND_A: 0, OFFICE: 0, OTHER: 0 } as Record<string, number>;
    for (const a of accounts) byCategory[a.commonCategory] = (byCategory[a.commonCategory] ?? 0) + 1;

    // 薪資支出(序3)..加班費(序19) = 17 items
    expect(byCategory.PERSONNEL).toBe(17);
    // 交通費(序21)..出口費用－報關費(序35) = 15 items
    expect(byCategory.SG_AND_A).toBe(15);
    // 租金支出(序37)..ICT工程費(序50) = 14 items
    expect(byCategory.OFFICE).toBe(14);
    // 呆帳(序52)..其他費用－其他(序67) = 16 items
    expect(byCategory.OTHER).toBe(16);
    expect(17 + 15 + 14 + 16).toBe(62);

    // Boundary spot-checks named explicitly in the requirement.
    const byName = new Map(accounts.map((a) => [a.name, a]));
    expect(byName.get("薪資支出")?.commonCategory).toBe("PERSONNEL");
    expect(byName.get("加班費")?.commonCategory).toBe("PERSONNEL");
    expect(byName.get("交通費")?.commonCategory).toBe("SG_AND_A");
    expect(byName.get("出口費用-報關費")?.commonCategory).toBe("SG_AND_A");
    expect(byName.get("租金支出")?.commonCategory).toBe("OFFICE");
    expect(byName.get("ICT工程費")?.commonCategory).toBe("OFFICE");
    expect(byName.get("呆帳")?.commonCategory).toBe("OTHER");
    expect(byName.get("其他費用-其他")?.commonCategory).toBe("OTHER");

    // The excluded subtotal/count rows must never appear as accounts.
    for (const excludedName of ["平均人數", "管理費用", "人事費用", "銷管費用", "辦公費用", "其他費用"]) {
      expect(byName.has(excludedName)).toBe(false);
    }
  });

  it("2025 reference amounts match the source spreadsheet exactly, per account and per category", async () => {
    setEnv("preview", "true");
    await seedDemoMasterData(TEST_BYPASS_USER_ID);
    const accounts = await prisma.account.findMany({ where: { sourceSeq: { in: DEMO_ACCOUNTS.map((a) => a.seq) } } });

    // Spot-check a few individual figures against the spreadsheet.
    const byName = new Map(accounts.map((a) => [a.name, a]));
    expect(byName.get("薪資支出")?.priorYearReferenceAmount?.toString()).toBe("7905511");
    expect(byName.get("呆帳")?.priorYearReferenceAmount?.toString()).toBe("-709704"); // legitimate negative (credit)
    expect(byName.get("勞務費")?.priorYearReferenceAmount?.toString()).toBe("6107000");

    // Per-category and grand totals cross-checked against the spreadsheet's own subtotal rows.
    for (const [category, expected] of Object.entries(EXPECTED_CATEGORY_TOTALS)) {
      const total = sumDecimals(
        accounts.filter((a) => a.commonCategory === category).map((a) => a.priorYearReferenceAmount)
      );
      expect(total.toString()).toBe(expected);
    }
    const grandTotal = sumDecimals(accounts.map((a) => a.priorYearReferenceAmount));
    expect(grandTotal.toString()).toBe(EXPECTED_GRAND_TOTAL);
  });

  it("running it repeatedly does not create duplicate rows", async () => {
    setEnv("preview", "true");
    await seedDemoMasterData(TEST_BYPASS_USER_ID);
    await seedDemoMasterData(TEST_BYPASS_USER_ID);
    await seedDemoMasterData(TEST_BYPASS_USER_ID);

    expect(await prisma.department.count({ where: { code: DEMO_DEPARTMENT_CODE } })).toBe(1);
    expect(await prisma.account.count({ where: { sourceSeq: { in: DEMO_ACCOUNTS.map((a) => a.seq) } } })).toBe(62);
  });

  it("never touches or removes pre-existing real department/account master data", async () => {
    const realDept = await prisma.department.create({
      data: { code: "REAL-DEPT", name: "真實部門", class: "M" },
    });
    const realAcct = await prisma.account.create({
      data: {
        code: "REAL-ACC",
        name: "真實科目",
        majorCategory: "M",
        commonCategory: "OFFICE",
        entryType: "DEPARTMENT_INPUT",
      },
    });

    setEnv("preview", "true");
    await seedDemoMasterData(TEST_BYPASS_USER_ID);

    expect(await prisma.department.findUnique({ where: { id: realDept.id } })).not.toBeNull();
    expect(await prisma.account.findUnique({ where: { id: realAcct.id } })).not.toBeNull();
  });

  it("never creates a User row for the virtual test-bypass identity", async () => {
    setEnv("preview", "true");
    await seedDemoMasterData(TEST_BYPASS_USER_ID);
    expect(await prisma.user.count()).toBe(0);
  });

  it("writes an audit log with actorUserId NULL and the [TEST_BYPASS_USER] marker", async () => {
    setEnv("preview", "true");
    await seedDemoMasterData(TEST_BYPASS_USER_ID);
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "DEMO_MASTER_DATA_SEEDED" } });
    expect(row.actorUserId).toBeNull();
    expect(row.reason).toContain("TEST_BYPASS_USER");
  });
});

describe("seedDemoMasterData - performance/atomicity regression guard for the P2028 'Transaction already closed' failure", () => {
  // The original implementation upserted the 62 accounts one row at a time
  // inside an interactive prisma.$transaction(async (tx) => ...) callback,
  // each awaited call round-tripping Node -> Neon. Under real Neon
  // serverless latency, ~130 sequential round trips (62 accounts x up to 2
  // statements, plus the legacy-cleanup lookups) exceeded Prisma's 5-second
  // interactive-transaction timeout and surfaced as
  // `PrismaClientKnownRequestError P2022... P2028: Transaction already
  // closed`. This is not something a local, low-latency test Postgres can
  // reproduce by simply waiting for a timeout - so instead of trying to
  // "simulate 5 seconds of latency", this test asserts the property that
  // actually prevents the failure at any latency: the number of SQL
  // statements executed is a small constant, not one (or two) per account.
  it("executes a small, constant number of SQL statements - not one round trip per account - regardless of the 62-account list size", async () => {
    setEnv("preview", "true");
    const queries: string[] = [];
    const listener = (e: { query: string }) => queries.push(e.query);
    prisma.$on("query" as never, listener as never);
    try {
      await seedDemoMasterData(TEST_BYPASS_USER_ID);
    } finally {
      // PrismaClient has no $off - the listener is harmless after this
      // point since nothing else queries db in this test, but scope the
      // array read to before any other work happens regardless.
    }

    // Previously this was O(DEMO_ACCOUNTS.length): 62 accounts x up to 2
    // statements/account (a SELECT-then-INSERT/UPDATE style upsert) plus a
    // handful of legacy-cleanup lookups - well over 100 statements. The
    // rewritten version is exactly 2 legacy-retirement UPDATEs + 1
    // department upsert (1-2 statements) + 1 multi-row account UPSERT = a
    // handful of statements, independent of DEMO_ACCOUNTS.length.
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.length).toBeLessThan(15);
    expect(queries.length).toBeLessThan(DEMO_ACCOUNT_COUNT);
  });

  it("a failure partway through the batch leaves no partial master data behind (same all-or-nothing primitive seedDemoMasterData relies on)", async () => {
    setEnv("preview", "true");
    // Uses the exact mechanism seedDemoMasterData uses internally (a
    // non-interactive prisma.$transaction([...]) batch) to prove the
    // "失敗時不得留下不完整的主檔" guarantee: one deliberately invalid
    // statement (bad enum value) in the batch must roll back every other
    // statement in the same batch, not just fail on its own.
    const deptUpsert = prisma.department.upsert({
      where: { code: DEMO_DEPARTMENT_CODE },
      update: { name: "財務管理處", class: "M", isActive: true },
      create: { code: DEMO_DEPARTMENT_CODE, name: "財務管理處", class: "M" },
    });
    const brokenAccountInsert = prisma.$executeRaw`
      INSERT INTO "Account" ("id", "code", "name", "majorCategory", "commonCategory", "entryType", "isActive")
      VALUES ('deliberately-broken-row', 'FIN-BROKEN-TEST', 'x', 'NOT_A_REAL_ENUM_VALUE'::"DeptClass", 'PERSONNEL'::"AccountCommonCategory", 'DEPARTMENT_INPUT'::"AccountEntryType", true)
    `;

    await expect(prisma.$transaction([deptUpsert, brokenAccountInsert])).rejects.toThrow();

    // Nothing from the failed batch was left behind - not even the
    // statement that would have succeeded on its own (the department
    // upsert), which is exactly the "no incomplete master data" guarantee.
    expect(await prisma.department.findUnique({ where: { code: DEMO_DEPARTMENT_CODE } })).toBeNull();
    expect(await prisma.account.findUnique({ where: { code: "FIN-BROKEN-TEST" } })).toBeNull();
  });
});

describe("createBudgetVersionDraft - performance/atomicity regression guard for the P2028 'Transaction already closed' failure", () => {
  // The original implementation created the BudgetVersion and then looped
  // over every active account, awaiting one `tx.budgetLine.create()` per
  // account inside an interactive `prisma.$transaction(async (tx) => ...)`
  // callback - 62 sequential round trips for the 財務管理處 demo dataset.
  // Under real Neon serverless latency this exceeded Prisma's 5-second
  // interactive-transaction timeout on POST /api/budgets, surfacing as
  // `PrismaClientKnownRequestError P2028: Transaction already closed`
  // (the same failure class already fixed for the 62-account seed in
  // seedDemoMasterData.ts). As there, the fix is asserted here by the
  // property that actually prevents it at any latency: a small, constant
  // number of SQL statements, not one per account.
  it("executes a small, constant number of SQL statements when creating a 62-line draft - not one round trip per account", async () => {
    setEnv("preview", "true");
    const demoDept = await seedOfficialAccountsFor17203();
    const bypassUser = testBypassUser();

    const queries: string[] = [];
    const listener = (e: { query: string }) => queries.push(e.query);
    prisma.$on("query" as never, listener as never);

    const draft = await createBudgetVersionDraft(bypassUser, demoDept.id, DEMO_FISCAL_YEAR);
    expect(draft.status).toBe("DRAFT");

    // Previously this was O(DEMO_ACCOUNT_COUNT): 62 accounts x 1 create each
    // (plus the pre-check/account-list reads) - 60+ statements just for the
    // line inserts. The rewritten version is exactly 3 write statements
    // (version insert, lines createMany, audit log insert) plus a couple of
    // read statements (duplicate-draft pre-check, active-account list) -
    // independent of DEMO_ACCOUNT_COUNT.
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.length).toBeLessThan(15);
    expect(queries.length).toBeLessThan(DEMO_ACCOUNT_COUNT);

    const lines = await prisma.budgetLine.findMany({ where: { budgetVersionId: draft.id } });
    expect(lines).toHaveLength(DEMO_ACCOUNT_COUNT);
  });

  it("a failure partway through the batch leaves no partial BudgetVersion/BudgetLine data behind", async () => {
    setEnv("preview", "true");
    await seedDemoMasterData(TEST_BYPASS_USER_ID);
    const demoDept = await prisma.department.findUniqueOrThrow({ where: { code: DEMO_DEPARTMENT_CODE } });

    // Uses the exact mechanism createBudgetVersionDraft uses internally (a
    // non-interactive prisma.$transaction([...]) batch): one deliberately
    // invalid statement in the batch must roll back every other statement
    // in the same batch, including the BudgetVersion insert that would have
    // succeeded on its own.
    const versionId = "deliberately-broken-version-id";
    const versionCreate = prisma.budgetVersion.create({
      data: {
        id: versionId,
        departmentId: demoDept.id,
        fiscalYear: DEMO_FISCAL_YEAR,
        versionNumber: 1,
        status: "DRAFT",
        lastPreparedAt: new Date(),
      },
    });
    const brokenLineInsert = prisma.$executeRaw`
      INSERT INTO "BudgetLine" ("id", "budgetVersionId", "accountId", "priorPriorYearActual", "priorYearOriginalBudget", "entryTypeSnapshot")
      VALUES ('broken-line', ${versionId}, 'not-a-real-account-id', 0, 0, 'NOT_A_REAL_ENUM_VALUE'::"AccountEntryType")
    `;

    await expect(prisma.$transaction([versionCreate, brokenLineInsert])).rejects.toThrow();

    expect(await prisma.budgetVersion.findUnique({ where: { id: versionId } })).toBeNull();
    expect(await prisma.budgetLine.findUnique({ where: { id: "broken-line" } })).toBeNull();
  });

  it("rejects a duplicate draft creation with a clear conflict, without creating a duplicate version or any lines", async () => {
    setEnv("preview", "true");
    const demoDept = await seedOfficialAccountsFor17203();
    const bypassUser = testBypassUser();

    await createBudgetVersionDraft(bypassUser, demoDept.id, DEMO_FISCAL_YEAR);
    await expect(createBudgetVersionDraft(bypassUser, demoDept.id, DEMO_FISCAL_YEAR)).rejects.toThrow(ApiError);

    expect(
      await prisma.budgetVersion.count({ where: { departmentId: demoDept.id, fiscalYear: DEMO_FISCAL_YEAR } })
    ).toBe(1);
    const onlyVersion = await prisma.budgetVersion.findFirstOrThrow({
      where: { departmentId: demoDept.id, fiscalYear: DEMO_FISCAL_YEAR },
    });
    expect(await prisma.budgetLine.count({ where: { budgetVersionId: onlyVersion.id } })).toBe(DEMO_ACCOUNT_COUNT);
  });
});

describe("legacy DEMO-DEPT / DEMO-ACC-* cleanup - safe and idempotent", () => {
  it("deactivates (never deletes) pre-existing legacy DEMO rows and converges to the 62 real accounts", async () => {
    // Simulate a Preview database still holding the earlier placeholder data.
    await prisma.department.create({
      data: { code: LEGACY_DEMO_DEPARTMENT_CODE, name: "DEMO 測試部門（舊版）", class: "UNCLASSIFIED" },
    });
    for (const code of LEGACY_DEMO_ACCOUNT_CODES) {
      await prisma.account.create({
        data: { code, name: `舊版測試科目 ${code}`, majorCategory: "UNCLASSIFIED", commonCategory: "OTHER", entryType: "DEPARTMENT_INPUT" },
      });
    }

    setEnv("preview", "true");
    const result = await seedDemoMasterData(TEST_BYPASS_USER_ID);

    expect(result.legacyRetired.departments).toEqual([LEGACY_DEMO_DEPARTMENT_CODE]);
    expect(result.legacyRetired.accounts).toEqual([...LEGACY_DEMO_ACCOUNT_CODES]);

    const legacyDept = await prisma.department.findUniqueOrThrow({ where: { code: LEGACY_DEMO_DEPARTMENT_CODE } });
    expect(legacyDept.isActive).toBe(false); // deactivated, not deleted
    for (const code of LEGACY_DEMO_ACCOUNT_CODES) {
      const legacyAcct = await prisma.account.findUniqueOrThrow({ where: { code } });
      expect(legacyAcct.isActive).toBe(false); // deactivated, not deleted
    }

    // Re-running "初始化 DEMO 主檔" (idempotent) still yields exactly 62 real accounts.
    const second = await seedDemoMasterData(TEST_BYPASS_USER_ID);
    expect(second.accountCount).toBe(62);
    expect(second.legacyRetired.departments).toEqual([]); // already retired, nothing left to do
    expect(second.legacyRetired.accounts).toEqual([]);
  });

  it("does not touch a legacy DEMO row that isn't present at all (nothing to retire)", async () => {
    setEnv("preview", "true");
    const result = await seedDemoMasterData(TEST_BYPASS_USER_ID);
    expect(result.legacyRetired.departments).toEqual([]);
    expect(result.legacyRetired.accounts).toEqual([]);
  });
});

describe("FIN-<seq> -> Excel 序號 account code migration - upgrading a database seeded before this change", () => {
  it("migrates a pre-existing FIN-<seq> coded row to the plain 序號 code in place (same id), rather than duplicating it", async () => {
    // Simulate a Preview database seeded by the earlier version of
    // seedDemoMasterData, which wrote provisional "FIN-003"-style codes.
    const preExisting = await prisma.account.create({
      data: {
        code: "FIN-003",
        name: "薪資支出",
        majorCategory: DEMO_DEPARTMENT_CLASS,
        commonCategory: "PERSONNEL",
        entryType: "DEPARTMENT_INPUT",
        isProvisionalCode: true,
        sourceSeq: 3,
        sourceRef: "2026年度費用預算V2--財務.xlsx｜財務工作表｜序3",
        priorYearReferenceAmount: "7905511",
      },
    });

    setEnv("preview", "true");
    const result = await seedDemoMasterData(TEST_BYPASS_USER_ID);

    expect(result.accountCount).toBe(62);
    // Same row (same id), migrated in place - never duplicated.
    expect(await prisma.account.count({ where: { sourceSeq: 3 } })).toBe(1);
    const migrated = await prisma.account.findUniqueOrThrow({ where: { id: preExisting.id } });
    expect(migrated.code).toBe("3");
    expect(migrated.isProvisionalCode).toBe(false);
    expect(migrated.sourceSeq).toBe(3);

    // Re-running again (idempotent) still converges to exactly 62 accounts,
    // no duplicates left behind by the migration.
    const second = await seedDemoMasterData(TEST_BYPASS_USER_ID);
    expect(second.accountCount).toBe(62);
    expect(await prisma.account.count({ where: { sourceSeq: { in: DEMO_ACCOUNTS.map((a) => a.seq) } } })).toBe(62);
  });

  it("rolls back the whole batch and returns a clear 繁體中文 error when the new code collides with a different account's existing code", async () => {
    // A pre-existing, unrelated real account already using code "3" (not
    // itself a DEMO row - sourceSeq is null) - the new Excel-序號-based
    // code for 序3 薪資支出 would collide with it.
    const unrelated = await prisma.account.create({
      data: { code: "3", name: "真實科目", majorCategory: "M", commonCategory: "OFFICE", entryType: "DEPARTMENT_INPUT" },
    });

    setEnv("preview", "true");
    await expect(seedDemoMasterData(TEST_BYPASS_USER_ID)).rejects.toThrow(ApiError);
    await expect(seedDemoMasterData(TEST_BYPASS_USER_ID)).rejects.toThrow(/科目編號.*衝突|衝突.*科目編號/);

    // Whole batch rolled back - nothing from this failed attempt was
    // created, and the unrelated account is completely untouched.
    expect(await prisma.department.findUnique({ where: { code: DEMO_DEPARTMENT_CODE } })).toBeNull();
    const unrelatedAfter = await prisma.account.findUniqueOrThrow({ where: { id: unrelated.id } });
    expect(unrelatedAfter.code).toBe("3");
    expect(unrelatedAfter.name).toBe("真實科目");
  });
});

describe("Preview bypass admin can hand-build and submit a test budget end to end", () => {
  it("creates a draft pre-populated with the real 2025 reference amounts (read-only), edits the 2026 amount, persists across a fresh reload, and submits", async () => {
    setEnv("preview", "true");
    const demoDept = await seedOfficialAccountsFor17203();
    const bypassUser = testBypassUser();

    const draft = await createBudgetVersionDraft(bypassUser, demoDept.id, DEMO_FISCAL_YEAR);
    expect(draft.status).toBe("DRAFT");
    // Never write the virtual sentinel id into this real User foreign key.
    expect(draft.preparedById).toBeNull();

    const salaryAccount = await prisma.account.findUniqueOrThrow({ where: { code: "3" } });
    const line = await prisma.budgetLine.findFirstOrThrow({
      where: { budgetVersionId: draft.id, accountId: salaryAccount.id },
    });
    // 2025 reference amount was seeded from the spreadsheet, not left at 0.
    expect(line.priorYearOriginalBudget.toString()).toBe("7905511");
    expect(line.projectionIsComplete).toBe(true);
    expect(line.nextYearTargetExcludingNew.toString()).toBe("0"); // 2026 not pre-filled

    await updateDepartmentInputLine(bypassUser, draft.id, line.id, {
      nextYearTargetExcludingNew: "8200000",
      nextYearNewHireBudget: "100000",
      justification: "依人力擴編計畫編列",
    });

    // "重新開啟後確認資料仍存在" - re-read from the database as a fresh query,
    // never trust the in-memory mutation result alone.
    const reloaded = await prisma.budgetLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(reloaded.nextYearTargetExcludingNew.toString()).toBe("8200000");
    expect(Number(reloaded.nextYearNewHireBudget)).toBe(100000);
    expect(Number(reloaded.nextYearTotal)).toBe(8300000);
    expect(reloaded.justification).toBe("依人力擴編計畫編列");
    // The 2025 reference figure is untouched by the 2026 edit - read-only.
    expect(reloaded.priorYearOriginalBudget.toString()).toBe("7905511");
    expect(reloaded.currentYearProjection?.toString()).toBe("7905511");

    // 增減金額／增減率 computed correctly against the real 2025 reference.
    const delta = Number(reloaded.nextYearTotal) - Number(reloaded.priorYearOriginalBudget);
    expect(delta).toBeCloseTo(8300000 - 7905511, 2);
    expect(reloaded.growthRateExcludingNew?.toString()).not.toBeNull();

    const submitted = await submitBudgetVersion(bypassUser, draft.id);
    expect(submitted.status).toBe("SUBMITTED");
    expect(submitted.submittedById).toBeNull();

    const reloadedVersion = await prisma.budgetVersion.findUniqueOrThrow({ where: { id: draft.id } });
    expect(reloadedVersion.status).toBe("SUBMITTED");
  });

  it("a freshly created line has createdAt === updatedAt (untouched signal for the UI's blank-input display), and an edit moves updatedAt forward", async () => {
    setEnv("preview", "true");
    const demoDept = await seedOfficialAccountsFor17203();
    const bypassUser = testBypassUser();
    const draft = await createBudgetVersionDraft(bypassUser, demoDept.id, DEMO_FISCAL_YEAR);
    const line = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: draft.id } });

    // BudgetVersionClient.tsx renders the 2026 amount inputs blank exactly
    // when createdAt === updatedAt - assert the service layer actually
    // produces that invariant, not just that it happens to look right today.
    expect(line.createdAt.getTime()).toBe(line.updatedAt.getTime());

    await updateDepartmentInputLine(bypassUser, draft.id, line.id, {
      nextYearTargetExcludingNew: "500",
      nextYearNewHireBudget: "0",
    });
    const afterEdit = await prisma.budgetLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(afterEdit.updatedAt.getTime()).toBeGreaterThan(afterEdit.createdAt.getTime());
  });

  it("a 2025 reference amount of 0 never causes a division-by-zero - growth rate is null, delta is still computed", async () => {
    setEnv("preview", "true");
    const demoDept = await seedOfficialAccountsFor17203();
    const bypassUser = testBypassUser();
    const draft = await createBudgetVersionDraft(bypassUser, demoDept.id, DEMO_FISCAL_YEAR);

    // 序4 業績獎金 (code "4") has priorYearReferenceAmount "0" in the source spreadsheet.
    const zeroRefAccount = await prisma.account.findUniqueOrThrow({ where: { code: "4" } });
    const line = await prisma.budgetLine.findFirstOrThrow({
      where: { budgetVersionId: draft.id, accountId: zeroRefAccount.id },
    });
    expect(line.priorYearOriginalBudget.toString()).toBe("0");

    const updated = await updateDepartmentInputLine(bypassUser, draft.id, line.id, {
      nextYearTargetExcludingNew: "10000",
      nextYearNewHireBudget: "0",
    });

    // No exception thrown above is itself part of the assertion (a naive
    // amount/base implementation would throw or produce Infinity/NaN here).
    expect(updated.growthRateExcludingNew).toBeNull();
    expect(updated.growthRateIncludingNew).toBeNull();
    expect(updated.nextYearTotal.toString()).toBe("10000");
    const delta = Number(updated.nextYearTotal) - Number(updated.priorYearOriginalBudget);
    expect(delta).toBe(10000); // 增減金額 still computable even though 增減率 is undefined
  });

  it("only the 2026 amount and justification are user-editable - account name/code/category never change", async () => {
    setEnv("preview", "true");
    const demoDept = await seedOfficialAccountsFor17203();
    const bypassUser = testBypassUser();
    const draft = await createBudgetVersionDraft(bypassUser, demoDept.id, DEMO_FISCAL_YEAR);
    const account = await prisma.account.findUniqueOrThrow({ where: { code: "39" } }); // 郵電費
    const line = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: draft.id, accountId: account.id } });

    await updateDepartmentInputLine(bypassUser, draft.id, line.id, {
      nextYearTargetExcludingNew: "40000",
      nextYearNewHireBudget: "0",
      justification: "依前期用量估算",
    });

    const accountAfter = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
    expect(accountAfter.name).toBe("郵電費");
    expect(accountAfter.code).toBe("39");
    expect(accountAfter.commonCategory).toBe("OFFICE");
  });

  it("category totals and the 管理費用 grand total are computed live from the 2026 line amounts, matching hand-computed sums", async () => {
    setEnv("preview", "true");
    const demoDept = await seedOfficialAccountsFor17203();
    const bypassUser = testBypassUser();
    const draft = await createBudgetVersionDraft(bypassUser, demoDept.id, DEMO_FISCAL_YEAR);

    const salaryLine = await prisma.budgetLine.findFirstOrThrow({
      where: { budgetVersionId: draft.id, account: { code: "3" } },
    });
    const postageLine = await prisma.budgetLine.findFirstOrThrow({
      where: { budgetVersionId: draft.id, account: { code: "39" } },
    });
    await updateDepartmentInputLine(bypassUser, draft.id, salaryLine.id, {
      nextYearTargetExcludingNew: "8000000",
      nextYearNewHireBudget: "0",
    });
    await updateDepartmentInputLine(bypassUser, draft.id, postageLine.id, {
      nextYearTargetExcludingNew: "35000",
      nextYearNewHireBudget: "0",
    });

    const lines = await prisma.budgetLine.findMany({ where: { budgetVersionId: draft.id }, include: { account: true } });
    const summary = computeCategorySummary(lines.map((l) => ({ commonCategory: l.account.commonCategory, amount: l.nextYearTotal })));

    const personnelRow = summary.rows.find((r) => r.category === "PERSONNEL")!;
    const officeRow = summary.rows.find((r) => r.category === "OFFICE")!;
    // Only code "3" (人事) and code "39" (辦公) were changed from 0, so those
    // two categories' totals must equal exactly what was entered.
    expect(personnelRow.total.toString()).toBe("8000000");
    expect(officeRow.total.toString()).toBe("35000");
    expect(summary.grandTotal.toString()).toBe("8035000");
  });

  it("rejects negative amounts exactly as it would for a real user (validation not skipped)", async () => {
    setEnv("preview", "true");
    const demoDept = await seedOfficialAccountsFor17203();
    const bypassUser = testBypassUser();
    const draft = await createBudgetVersionDraft(bypassUser, demoDept.id, DEMO_FISCAL_YEAR);
    const line = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: draft.id } });

    await expect(
      updateDepartmentInputLine(bypassUser, draft.id, line.id, {
        nextYearTargetExcludingNew: "-1",
        nextYearNewHireBudget: "0",
      })
    ).rejects.toThrow(ApiError);
  });
});

describe("Preview bypass admin still cannot bypass segregation-of-duties controls", () => {
  it("has no review/approve capability, so it cannot advance its own submission past SUBMITTED", async () => {
    setEnv("preview", "true");
    const demoDept = await seedOfficialAccountsFor17203();
    const bypassUser = testBypassUser();
    const draft = await createBudgetVersionDraft(bypassUser, demoDept.id, DEMO_FISCAL_YEAR);
    await submitBudgetVersion(bypassUser, draft.id);

    await expect(startReview(bypassUser, draft.id)).rejects.toThrow(ApiError);
  });
});
