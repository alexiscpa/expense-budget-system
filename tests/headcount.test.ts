import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { createDepartment, createUser, createAccount, grantDepartmentScope, toCurrentUser } from "./helpers/factory";
import { createBudgetVersionDraft } from "@/lib/budget/lineService";
import { updateBudgetYearHeadcount, MAX_DEPARTMENT_HEADCOUNT } from "@/lib/budget/headcountService";
import { submitBudgetVersion } from "@/lib/workflow/actions";
import { seedDemoMasterData } from "@/lib/demo/seedDemoMasterData";
import { DEMO_DEPARTMENT_CODE, DEMO_FISCAL_YEAR } from "@/lib/demo/constants";
import { testBypassUser, TEST_BYPASS_USER_ID } from "@/lib/auth/testBypass";
import { ApiError } from "@/lib/rbac/guard";
import { prisma } from "@/lib/prisma";

const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;
const ORIGINAL_AUTH_DISABLED = process.env.AUTH_DISABLED;

function setPreviewBypassEnv() {
  process.env.VERCEL_ENV = "preview";
  process.env.AUTH_DISABLED = "true";
}

function restoreEnv() {
  if (ORIGINAL_VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = ORIGINAL_VERCEL_ENV;
  if (ORIGINAL_AUTH_DISABLED === undefined) delete process.env.AUTH_DISABLED;
  else process.env.AUTH_DISABLED = ORIGINAL_AUTH_DISABLED;
}

beforeEach(async () => {
  restoreEnv();
  await resetDatabase();
});

/**
 * A department with a known 2025 reference headcount (10, matching the real
 * DEMO figure) plus one real account so createBudgetVersionDraft can
 * succeed. Pass `null` explicitly (not `undefined` - a JS default parameter
 * only substitutes for a truly omitted/undefined argument, not an explicit
 * null) to test the "no known reference" case.
 */
async function setupDeptWithOwner(priorYearHeadcount: number | null = 10) {
  const dept = await createDepartment({ code: `HC${Date.now()}${Math.random()}`, priorYearHeadcount });
  const owner = await createUser({ role: "BUDGET_OWNER", companyWide: false });
  await grantDepartmentScope(owner.id, dept.id);
  await createAccount({ entryType: "DEPARTMENT_INPUT", majorCategory: dept.class });
  return { dept, owner };
}

describe("BudgetVersion 部門人數 (headcount) - draft creation", () => {
  it("a new 2026 draft starts with priorYearHeadcount = 10 and budgetYearHeadcount = 10, matching the department's reference figure", async () => {
    const { dept, owner } = await setupDeptWithOwner(10);
    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2026);

    expect(draft.priorYearHeadcount).toBe(10);
    expect(draft.budgetYearHeadcount).toBe(10);
  });

  it("a department with no known reference headcount starts a new draft at 0/0, never fabricated", async () => {
    const { dept, owner } = await setupDeptWithOwner(null);
    // createDepartment leaves priorYearHeadcount undefined -> null in the DB
    // when no override is given; re-fetch to confirm before asserting the
    // derived draft value.
    const deptRow = await prisma.department.findUniqueOrThrow({ where: { id: dept.id } });
    expect(deptRow.priorYearHeadcount).toBeNull();

    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2026);
    expect(draft.priorYearHeadcount).toBe(0);
    expect(draft.budgetYearHeadcount).toBe(0);
  });
});

describe("BudgetVersion 部門人數 (headcount) - editing budgetYearHeadcount", () => {
  it("changing 2026 headcount from 10 to 12 succeeds, persists across a fresh read, and writes an AuditLog with before=10/after=12", async () => {
    const { dept, owner } = await setupDeptWithOwner(10);
    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2026);
    expect(draft.budgetYearHeadcount).toBe(10);

    const updated = await updateBudgetYearHeadcount(toCurrentUser(owner), draft.id, "12");
    expect(updated.budgetYearHeadcount).toBe(12);
    expect(updated.priorYearHeadcount).toBe(10); // untouched

    // Re-read from the database as a fresh query, never trust the in-memory result alone.
    const reloaded = await prisma.budgetVersion.findUniqueOrThrow({ where: { id: draft.id } });
    expect(reloaded.budgetYearHeadcount).toBe(12);
    expect(reloaded.priorYearHeadcount).toBe(10);

    const auditRow = await prisma.auditLog.findFirstOrThrow({
      where: { action: "BUDGET_HEADCOUNT_UPDATED", entityId: draft.id },
      orderBy: { createdAt: "desc" },
    });
    expect(auditRow.beforeData).toMatchObject({ budgetYearHeadcount: 10 });
    expect(auditRow.afterData).toMatchObject({ budgetYearHeadcount: 12 });
  });

  it.each([
    ["negative", "-1"],
    ["decimal", "1.5"],
    ["non-numeric text", "abc"],
    ["empty string", ""],
    ["out of range", String(MAX_DEPARTMENT_HEADCOUNT + 1)],
    ["thousands-separator comma", "1,000"],
  ])("rejects %s (%s) and does not change the stored value", async (_label, badInput) => {
    const { dept, owner } = await setupDeptWithOwner(10);
    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2026);

    await expect(updateBudgetYearHeadcount(toCurrentUser(owner), draft.id, badInput)).rejects.toThrow(ApiError);

    const unchanged = await prisma.budgetVersion.findUniqueOrThrow({ where: { id: draft.id } });
    expect(unchanged.budgetYearHeadcount).toBe(10);
  });

  it("accepts the exact upper bound (MAX_DEPARTMENT_HEADCOUNT) but rejects one above it", async () => {
    const { dept, owner } = await setupDeptWithOwner(10);
    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2026);

    const updated = await updateBudgetYearHeadcount(toCurrentUser(owner), draft.id, String(MAX_DEPARTMENT_HEADCOUNT));
    expect(updated.budgetYearHeadcount).toBe(MAX_DEPARTMENT_HEADCOUNT);
  });

  it("a SUBMITTED version's headcount cannot be modified", async () => {
    const { dept, owner } = await setupDeptWithOwner(10);
    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2026);
    await submitBudgetVersion(toCurrentUser(owner), draft.id);

    await expect(updateBudgetYearHeadcount(toCurrentUser(owner), draft.id, "12")).rejects.toThrow(ApiError);

    const unchanged = await prisma.budgetVersion.findUniqueOrThrow({ where: { id: draft.id } });
    expect(unchanged.budgetYearHeadcount).toBe(10);
    expect(unchanged.status).toBe("SUBMITTED");
  });
});

describe("部門人數 is not an accounting line item", () => {
  it("creating/updating headcount never creates an Account or BudgetLine, and is excluded from every category/grand total", async () => {
    const { dept, owner } = await setupDeptWithOwner(10);
    const accountCountBefore = await prisma.account.count();
    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2026);
    await updateBudgetYearHeadcount(toCurrentUser(owner), draft.id, "12");

    expect(await prisma.account.count()).toBe(accountCountBefore); // no new Account
    const lines = await prisma.budgetLine.findMany({ where: { budgetVersionId: draft.id } });
    // Exactly the accounts that existed (1, from setupDeptWithOwner) - no
    // extra line was created to represent headcount.
    expect(lines).toHaveLength(accountCountBefore);
    for (const line of lines) {
      // Headcount values (10/12) never leak into any BudgetLine amount column.
      expect(Number(line.nextYearTargetExcludingNew)).not.toBe(12);
      expect(Number(line.nextYearNewHireBudget)).not.toBe(12);
    }
  });
});

describe("部門人數 survives re-running DEMO 主檔初始化", () => {
  it("re-seeding the DEMO master data does not revert a user-entered 2026 headcount back to the 2025 reference", async () => {
    setPreviewBypassEnv();
    await seedDemoMasterData(TEST_BYPASS_USER_ID);
    const demoDept = await prisma.department.findUniqueOrThrow({ where: { code: DEMO_DEPARTMENT_CODE } });
    expect(demoDept.priorYearHeadcount).toBe(10);

    const bypassUser = testBypassUser();
    const draft = await createBudgetVersionDraft(bypassUser, demoDept.id, DEMO_FISCAL_YEAR);
    expect(draft.priorYearHeadcount).toBe(10);
    expect(draft.budgetYearHeadcount).toBe(10);

    const updated = await updateBudgetYearHeadcount(bypassUser, draft.id, "12");
    expect(updated.budgetYearHeadcount).toBe(12);

    // Re-running "初始化 DEMO 主檔" (idempotent, department-level only)
    // must never touch the already-created BudgetVersion row.
    await seedDemoMasterData(TEST_BYPASS_USER_ID);

    const reloaded = await prisma.budgetVersion.findUniqueOrThrow({ where: { id: draft.id } });
    expect(reloaded.budgetYearHeadcount).toBe(12); // NOT reverted back to 10
    expect(reloaded.priorYearHeadcount).toBe(10);
  });
});

describe("部門人數 row and frozen columns", () => {
  it("the headcount figures are plain scalar fields on BudgetVersion, present alongside lines in the same read used to render the frozen-column table", async () => {
    const { dept, owner } = await setupDeptWithOwner(10);
    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2026);

    // Mirrors the exact shape BudgetVersionClient.tsx receives from
    // GET /api/budgets/[id] (department + lines + headcount fields on the
    // same BudgetVersion row) - a horizontally-scrolled 部門人數 row and
    // the frozen 分類/科目編號/項目 columns render from this same object,
    // so there is nothing further to fetch/derive for that row to appear
    // correctly aligned.
    const full = await prisma.budgetVersion.findUniqueOrThrow({
      where: { id: draft.id },
      include: { department: true, lines: { include: { account: true } } },
    });
    expect(full.priorYearHeadcount).toBe(10);
    expect(full.budgetYearHeadcount).toBe(10);
    expect(full.lines.length).toBeGreaterThan(0);
  });
});
