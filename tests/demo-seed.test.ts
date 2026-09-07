import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { seedDemoMasterData, getDemoSeedStatus } from "@/lib/demo/seedDemoMasterData";
import { DEMO_DEPARTMENT_CODE, DEMO_ACCOUNTS, DEMO_FISCAL_YEAR } from "@/lib/demo/constants";
import { createBudgetVersionDraft, updateDepartmentInputLine } from "@/lib/budget/lineService";
import { submitBudgetVersion, startReview } from "@/lib/workflow/actions";
import { testBypassUser, TEST_BYPASS_USER_ID } from "@/lib/auth/testBypass";
import { ApiError } from "@/lib/rbac/guard";
import { prisma } from "@/lib/prisma";

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

describe("seedDemoMasterData - idempotent, non-destructive creation (Preview + AUTH_DISABLED=true)", () => {
  it("creates exactly one DEMO department and three DEMO accounts, with no budget amounts", async () => {
    setEnv("preview", "true");
    const result = await seedDemoMasterData(TEST_BYPASS_USER_ID);

    expect(result.department.code).toBe(DEMO_DEPARTMENT_CODE);
    expect(result.accounts).toHaveLength(3);
    expect(result.fiscalYear).toBe(DEMO_FISCAL_YEAR);

    expect(await prisma.department.count({ where: { code: DEMO_DEPARTMENT_CODE } })).toBe(1);
    expect(
      await prisma.account.count({ where: { code: { in: DEMO_ACCOUNTS.map((a) => a.code) } } })
    ).toBe(3);
    // No budget amounts/lines are ever pre-created - those must be entered by hand.
    expect(await prisma.budgetVersion.count()).toBe(0);
    expect(await prisma.budgetLine.count()).toBe(0);
  });

  it("running it repeatedly does not create duplicate rows", async () => {
    setEnv("preview", "true");
    await seedDemoMasterData(TEST_BYPASS_USER_ID);
    await seedDemoMasterData(TEST_BYPASS_USER_ID);
    await seedDemoMasterData(TEST_BYPASS_USER_ID);

    expect(await prisma.department.count({ where: { code: DEMO_DEPARTMENT_CODE } })).toBe(1);
    expect(
      await prisma.account.count({ where: { code: { in: DEMO_ACCOUNTS.map((a) => a.code) } } })
    ).toBe(3);
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

describe("Preview bypass admin can hand-build and submit a test budget end to end", () => {
  it("creates a draft, edits an amount, persists across a fresh reload, and submits", async () => {
    setEnv("preview", "true");
    await seedDemoMasterData(TEST_BYPASS_USER_ID);
    const demoDept = await prisma.department.findUniqueOrThrow({ where: { code: DEMO_DEPARTMENT_CODE } });
    const bypassUser = testBypassUser();

    const draft = await createBudgetVersionDraft(bypassUser, demoDept.id, DEMO_FISCAL_YEAR);
    expect(draft.status).toBe("DRAFT");
    // Never write the virtual sentinel id into this real User foreign key.
    expect(draft.preparedById).toBeNull();

    const line = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: draft.id } });
    expect(line.nextYearTargetExcludingNew.toString()).toBe("0");

    await updateDepartmentInputLine(bypassUser, draft.id, line.id, {
      nextYearTargetExcludingNew: "12345.67",
      nextYearNewHireBudget: "100",
    });

    // "重新開啟後確認資料仍存在" - re-read from the database as a fresh query,
    // never trust the in-memory mutation result alone.
    const reloaded = await prisma.budgetLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(reloaded.nextYearTargetExcludingNew.toString()).toBe("12345.67");
    expect(Number(reloaded.nextYearNewHireBudget)).toBe(100);
    expect(Number(reloaded.nextYearTotal)).toBe(12445.67);

    const submitted = await submitBudgetVersion(bypassUser, draft.id);
    expect(submitted.status).toBe("SUBMITTED");
    expect(submitted.submittedById).toBeNull();

    const reloadedVersion = await prisma.budgetVersion.findUniqueOrThrow({ where: { id: draft.id } });
    expect(reloadedVersion.status).toBe("SUBMITTED");
  });

  it("records BUDGET_VERSION_CREATED and BUDGET_SUBMITTED audit entries marked as TEST_BYPASS_USER", async () => {
    setEnv("preview", "true");
    await seedDemoMasterData(TEST_BYPASS_USER_ID);
    const demoDept = await prisma.department.findUniqueOrThrow({ where: { code: DEMO_DEPARTMENT_CODE } });
    const bypassUser = testBypassUser();

    const draft = await createBudgetVersionDraft(bypassUser, demoDept.id, DEMO_FISCAL_YEAR);
    await submitBudgetVersion(bypassUser, draft.id);

    const created = await prisma.auditLog.findFirstOrThrow({
      where: { action: "BUDGET_VERSION_CREATED", entityId: draft.id },
    });
    expect(created.actorUserId).toBeNull();
    expect(created.reason).toContain("TEST_BYPASS_USER");

    const submitted = await prisma.auditLog.findFirstOrThrow({
      where: { action: "BUDGET_SUBMITTED", entityId: draft.id },
    });
    expect(submitted.actorUserId).toBeNull();
    expect(submitted.reason).toContain("TEST_BYPASS_USER");
  });

  it("rejects negative amounts exactly as it would for a real user (validation not skipped)", async () => {
    setEnv("preview", "true");
    await seedDemoMasterData(TEST_BYPASS_USER_ID);
    const demoDept = await prisma.department.findUniqueOrThrow({ where: { code: DEMO_DEPARTMENT_CODE } });
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
    await seedDemoMasterData(TEST_BYPASS_USER_ID);
    const demoDept = await prisma.department.findUniqueOrThrow({ where: { code: DEMO_DEPARTMENT_CODE } });
    const bypassUser = testBypassUser();
    const draft = await createBudgetVersionDraft(bypassUser, demoDept.id, DEMO_FISCAL_YEAR);
    await submitBudgetVersion(bypassUser, draft.id);

    await expect(startReview(bypassUser, draft.id)).rejects.toThrow(ApiError);
  });
});
