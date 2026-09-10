import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { createDepartment, createUser, createAccount, grantDepartmentScope, toCurrentUser } from "./helpers/factory";
import { createBudgetVersionDraft, updateDepartmentInputLine } from "@/lib/budget/lineService";
import { updateBudgetYearHeadcount } from "@/lib/budget/headcountService";
import { submitBudgetVersion, startReview, withdrawBudgetSubmission } from "@/lib/workflow/actions";
import { seedDemoMasterData } from "@/lib/demo/seedDemoMasterData";
import { DEMO_DEPARTMENT_CODE, DEMO_DEPARTMENT_CLASS, DEMO_FISCAL_YEAR } from "@/lib/demo/constants";
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

async function setupDeptWithOwner() {
  const dept = await createDepartment({
    code: `WD${Date.now()}${Math.random()}`,
    priorYearHeadcount: 10,
    priorYearReferenceFiscalYear: 2025, // matches the 2026 drafts this file creates (referenceYear = 2026 - 1)
  });
  const owner = await createUser({ role: "BUDGET_OWNER", companyWide: false });
  await grantDepartmentScope(owner.id, dept.id);
  await createAccount({ entryType: "DEPARTMENT_INPUT", majorCategory: dept.class });
  return { dept, owner };
}

async function draftToSubmitted(dept: Awaited<ReturnType<typeof createDepartment>>, owner: Awaited<ReturnType<typeof createUser>>) {
  const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2026);
  const line = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: draft.id } });
  await updateDepartmentInputLine(toCurrentUser(owner), draft.id, line.id, {
    nextYearTargetExcludingNew: "50000",
    nextYearNewHireBudget: "0",
    justification: "測試編列依據",
  });
  await updateBudgetYearHeadcount(toCurrentUser(owner), draft.id, "12");
  const submitted = await submitBudgetVersion(toCurrentUser(owner), draft.id);
  return { submitted, line };
}

describe("撤回修改 (withdraw submission) - SUBMITTED -> DRAFT", () => {
  it("1. a legitimate preparer can withdraw a SUBMITTED version back to DRAFT", async () => {
    const { dept, owner } = await setupDeptWithOwner();
    const { submitted } = await draftToSubmitted(dept, owner);
    expect(submitted.status).toBe("SUBMITTED");

    const withdrawn = await withdrawBudgetSubmission(toCurrentUser(owner), submitted.id);
    expect(withdrawn.status).toBe("DRAFT");

    const reloaded = await prisma.budgetVersion.findUniqueOrThrow({ where: { id: submitted.id } });
    expect(reloaded.status).toBe("DRAFT");
  });

  it("2. amounts, justification, headcount, and versionNumber are fully preserved across withdraw", async () => {
    const { dept, owner } = await setupDeptWithOwner();
    const { submitted, line } = await draftToSubmitted(dept, owner);

    await withdrawBudgetSubmission(toCurrentUser(owner), submitted.id);

    const reloadedVersion = await prisma.budgetVersion.findUniqueOrThrow({ where: { id: submitted.id } });
    expect(reloadedVersion.versionNumber).toBe(1);
    expect(reloadedVersion.budgetYearHeadcount).toBe(12);
    expect(reloadedVersion.priorYearHeadcount).toBe(10);

    const reloadedLine = await prisma.budgetLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(reloadedLine.nextYearTargetExcludingNew.toString()).toBe("50000");
    expect(reloadedLine.justification).toBe("測試編列依據");
  });

  it("3. after withdrawing, the amount can be edited and the version re-submitted", async () => {
    const { dept, owner } = await setupDeptWithOwner();
    const { submitted, line } = await draftToSubmitted(dept, owner);
    await withdrawBudgetSubmission(toCurrentUser(owner), submitted.id);

    const updatedLine = await updateDepartmentInputLine(toCurrentUser(owner), submitted.id, line.id, {
      nextYearTargetExcludingNew: "75000",
      nextYearNewHireBudget: "0",
      justification: "撤回後修改",
    });
    expect(updatedLine.nextYearTargetExcludingNew.toString()).toBe("75000");

    const resubmitted = await submitBudgetVersion(toCurrentUser(owner), submitted.id);
    expect(resubmitted.status).toBe("SUBMITTED");
  });

  it("4a. UNDER_REVIEW cannot be withdrawn - returns 409 with the specific reviewer-handoff message", async () => {
    const { dept, owner } = await setupDeptWithOwner();
    const reviewer = await createUser({ role: "FINANCE_REVIEWER", companyWide: true });
    const { submitted } = await draftToSubmitted(dept, owner);
    await startReview(toCurrentUser(reviewer), submitted.id);

    await expect(withdrawBudgetSubmission(toCurrentUser(owner), submitted.id)).rejects.toThrow(
      "預算已進入審核程序，無法自行撤回，請由審核人員退回修改。"
    );

    const unchanged = await prisma.budgetVersion.findUniqueOrThrow({ where: { id: submitted.id } });
    expect(unchanged.status).toBe("UNDER_REVIEW");
  });

  it("4b. a DRAFT (never submitted) cannot be withdrawn (no SUBMITTED->DRAFT transition applies)", async () => {
    const { dept, owner } = await setupDeptWithOwner();
    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2026);

    await expect(withdrawBudgetSubmission(toCurrentUser(owner), draft.id)).rejects.toThrow(ApiError);
  });

  it("5. a user without edit capability for this department cannot withdraw", async () => {
    const { dept, owner } = await setupDeptWithOwner();
    const { submitted } = await draftToSubmitted(dept, owner);

    const outsider = await createUser({ role: "BUDGET_OWNER", companyWide: false }); // no scope on this department
    await expect(withdrawBudgetSubmission(toCurrentUser(outsider), submitted.id)).rejects.toThrow(ApiError);

    const readOnlyUser = await createUser({ role: "READ_ONLY", companyWide: true });
    await expect(withdrawBudgetSubmission(toCurrentUser(readOnlyUser), submitted.id)).rejects.toThrow(ApiError);

    const unchanged = await prisma.budgetVersion.findUniqueOrThrow({ where: { id: submitted.id } });
    expect(unchanged.status).toBe("SUBMITTED");
  });

  it("6. withdrawing writes a BUDGET_SUBMISSION_WITHDRAWN AuditLog with actor, timestamp, and before/after status", async () => {
    const { dept, owner } = await setupDeptWithOwner();
    const { submitted } = await draftToSubmitted(dept, owner);
    const before = new Date();

    await withdrawBudgetSubmission(toCurrentUser(owner), submitted.id);

    const auditRow = await prisma.auditLog.findFirstOrThrow({
      where: { action: "BUDGET_SUBMISSION_WITHDRAWN", entityId: submitted.id },
      orderBy: { createdAt: "desc" },
    });
    expect(auditRow.actorUserId).toBe(owner.id);
    expect(auditRow.beforeData).toMatchObject({ status: "SUBMITTED" });
    expect(auditRow.afterData).toMatchObject({ status: "DRAFT" });
    expect(auditRow.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
  });

  it("15. Preview TEST_BYPASS_USER can complete the full withdraw -> edit -> re-submit flow", async () => {
    setPreviewBypassEnv();
    await seedDemoMasterData(TEST_BYPASS_USER_ID);
    const demoDept = await prisma.department.findUniqueOrThrow({ where: { code: DEMO_DEPARTMENT_CODE } });
    // seedDemoMasterData's own accounts are catalog:"FINANCE_DEMO" (never
    // selected by createBudgetVersionDraft - see accountSelection.ts), so a
    // real OFFICIAL account for 17203's class is seeded separately here to
    // stand in for "Stage 2B-2 has already provisioned 17203's real chart",
    // exactly as in a real environment. This test's own subject (withdraw ->
    // edit -> re-submit) doesn't depend on which/how many accounts exist.
    await createAccount({ entryType: "DEPARTMENT_INPUT", majorCategory: DEMO_DEPARTMENT_CLASS });
    const bypassUser = testBypassUser();

    const draft = await createBudgetVersionDraft(bypassUser, demoDept.id, DEMO_FISCAL_YEAR);
    const line = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: draft.id } });
    await updateDepartmentInputLine(bypassUser, draft.id, line.id, {
      nextYearTargetExcludingNew: "10000",
      nextYearNewHireBudget: "0",
    });
    const submitted = await submitBudgetVersion(bypassUser, draft.id);
    expect(submitted.status).toBe("SUBMITTED");

    const withdrawn = await withdrawBudgetSubmission(bypassUser, draft.id);
    expect(withdrawn.status).toBe("DRAFT");

    await updateDepartmentInputLine(bypassUser, draft.id, line.id, {
      nextYearTargetExcludingNew: "20000",
      nextYearNewHireBudget: "0",
    });

    const resubmitted = await submitBudgetVersion(bypassUser, draft.id);
    expect(resubmitted.status).toBe("SUBMITTED");

    const finalLine = await prisma.budgetLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(finalLine.nextYearTargetExcludingNew.toString()).toBe("20000");

    const auditRow = await prisma.auditLog.findFirstOrThrow({
      where: { action: "BUDGET_SUBMISSION_WITHDRAWN", entityId: draft.id },
    });
    expect(auditRow.actorUserId).toBeNull();
    expect(auditRow.reason).toContain("TEST_BYPASS_USER");
  });
});

describe("撤回修改 never deletes/recreates BudgetVersion or BudgetLine rows", () => {
  it("14. withdraw and a subsequent edit never add, remove, or duplicate BudgetLine rows", async () => {
    const { dept, owner } = await setupDeptWithOwner();
    const { submitted, line } = await draftToSubmitted(dept, owner);
    const lineCountBefore = await prisma.budgetLine.count({ where: { budgetVersionId: submitted.id } });
    const versionRowId = submitted.id;

    const withdrawn = await withdrawBudgetSubmission(toCurrentUser(owner), submitted.id);
    expect(withdrawn.id).toBe(versionRowId); // same row, not recreated

    await updateDepartmentInputLine(toCurrentUser(owner), submitted.id, line.id, {
      nextYearTargetExcludingNew: "99000",
      nextYearNewHireBudget: "0",
    });

    const lineCountAfter = await prisma.budgetLine.count({ where: { budgetVersionId: submitted.id } });
    expect(lineCountAfter).toBe(lineCountBefore);
    const reloadedLine = await prisma.budgetLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(reloadedLine.id).toBe(line.id); // same row, not recreated
  });
});
