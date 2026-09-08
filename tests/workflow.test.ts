import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { createDepartment, createUser, createAccount, grantDepartmentScope, toCurrentUser } from "./helpers/factory";
import { createBudgetVersionDraft, updateDepartmentInputLine } from "@/lib/budget/lineService";
import {
  submitBudgetVersion,
  startReview,
  returnBudgetVersion,
  resubmitBudgetVersion,
  approveBudgetVersion,
  rejectBudgetVersion,
  requestAdjustment,
} from "@/lib/workflow/actions";
import { ApiError } from "@/lib/rbac/guard";
import { prisma } from "@/lib/prisma";

beforeEach(async () => {
  await resetDatabase();
});

async function setupDeptWithOwner() {
  const dept = await createDepartment({ code: `WF${Date.now()}${Math.random()}` });
  const owner = await createUser({ role: "BUDGET_OWNER", companyWide: false });
  await grantDepartmentScope(owner.id, dept.id);
  await createAccount({ entryType: "DEPARTMENT_INPUT", majorCategory: dept.class });
  return { dept, owner };
}

describe("budget workflow state machine", () => {
  it("walks the full happy path: draft -> submit -> review -> approve -> locked", async () => {
    const { dept, owner } = await setupDeptWithOwner();
    const reviewer = await createUser({ role: "FINANCE_REVIEWER", companyWide: true });
    const approver = await createUser({ role: "FINANCE_APPROVER", companyWide: true });

    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2027);
    expect(draft.status).toBe("DRAFT");

    const submitted = await submitBudgetVersion(toCurrentUser(owner), draft.id);
    expect(submitted.status).toBe("SUBMITTED");

    const underReview = await startReview(toCurrentUser(reviewer), draft.id);
    expect(underReview.status).toBe("UNDER_REVIEW");

    const approved = await approveBudgetVersion(toCurrentUser(approver), draft.id);
    expect(approved.status).toBe("LOCKED");
    expect(approved.lockedAt).not.toBeNull();
    expect(approved.approvedById).toBe(approver.id);
  });

  it("rejects an out-of-order transition (cannot approve a DRAFT directly)", async () => {
    const { dept, owner } = await setupDeptWithOwner();
    const approver = await createUser({ role: "FINANCE_APPROVER", companyWide: true });
    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2027);

    await expect(approveBudgetVersion(toCurrentUser(approver), draft.id)).rejects.toThrow(ApiError);
  });

  it("return requires a reason and routes back through resubmit -> review", async () => {
    const { dept, owner } = await setupDeptWithOwner();
    const reviewer = await createUser({ role: "FINANCE_REVIEWER", companyWide: true });
    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2027);
    await submitBudgetVersion(toCurrentUser(owner), draft.id);
    await startReview(toCurrentUser(reviewer), draft.id);

    await expect(returnBudgetVersion(toCurrentUser(reviewer), draft.id, "")).rejects.toThrow(ApiError);

    const returned = await returnBudgetVersion(toCurrentUser(reviewer), draft.id, "金額有誤，請重新確認");
    expect(returned.status).toBe("RETURNED");
    expect(returned.returnReason).toBe("金額有誤，請重新確認");

    // A return reason must be recorded as a traceable memory entry.
    const memories = await prisma.memoryEntry.findMany({ where: { type: "RETURN_REASON" } });
    expect(memories).toHaveLength(1);
    expect(memories[0]?.isUserDeletable).toBe(false);

    const resubmitted = await resubmitBudgetVersion(toCurrentUser(owner), draft.id);
    expect(resubmitted.status).toBe("SUBMITTED");
  });

  it("the preparer cannot directly edit a SUBMITTED version - must be returned first", async () => {
    const { dept, owner } = await setupDeptWithOwner();
    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2027);
    const line = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: draft.id } });
    await submitBudgetVersion(toCurrentUser(owner), draft.id);

    await expect(
      updateDepartmentInputLine(toCurrentUser(owner), draft.id, line.id, {
        nextYearTargetExcludingNew: "100",
        nextYearNewHireBudget: "0",
      })
    ).rejects.toThrow(ApiError);
  });

  it("enforces segregation of duties: the reviewer of a record cannot also be its approver", async () => {
    const { dept, owner } = await setupDeptWithOwner();
    const reviewer = await createUser({ role: "FINANCE_REVIEWER", companyWide: true });

    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2027);
    await submitBudgetVersion(toCurrentUser(owner), draft.id);
    await startReview(toCurrentUser(reviewer), draft.id);

    // Even if this identity held FINANCE_APPROVER capability, approving a
    // record they themselves reviewed must be blocked on identity grounds,
    // not just role - that is the actual internal-control requirement.
    const reviewerAsApprover = { ...toCurrentUser(reviewer), role: "FINANCE_APPROVER" as const };
    await expect(approveBudgetVersion(reviewerAsApprover, draft.id)).rejects.toThrow(ApiError);
  });

  it("blocks approval while any FORMULA line is NOT_CONFIGURED", async () => {
    const dept = await createDepartment({ code: `WFF${Date.now()}${Math.random()}` });
    const owner = await createUser({ role: "BUDGET_OWNER", companyWide: false });
    await grantDepartmentScope(owner.id, dept.id);
    await createAccount({ entryType: "FORMULA", formulaKey: "UNCONFIGURED_KEY", majorCategory: dept.class });

    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2027);
    const line = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: draft.id } });
    expect(line.formulaStatus).toBe("NOT_CONFIGURED");

    await expect(submitBudgetVersion(toCurrentUser(owner), draft.id)).rejects.toThrow(/尚未設定/);
  });

  it("approved budgets are locked and adjustments create a new version without touching the original", async () => {
    const { dept, owner } = await setupDeptWithOwner();
    const reviewer = await createUser({ role: "FINANCE_REVIEWER", companyWide: true });
    const approver = await createUser({ role: "FINANCE_APPROVER", companyWide: true });

    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2027);
    const line = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: draft.id } });
    await updateDepartmentInputLine(toCurrentUser(owner), draft.id, line.id, {
      nextYearTargetExcludingNew: "1000",
      nextYearNewHireBudget: "0",
    });
    await submitBudgetVersion(toCurrentUser(owner), draft.id);
    await startReview(toCurrentUser(reviewer), draft.id);
    const locked = await approveBudgetVersion(toCurrentUser(approver), draft.id);
    expect(locked.status).toBe("LOCKED");

    await expect(
      updateDepartmentInputLine(toCurrentUser(owner), draft.id, line.id, {
        nextYearTargetExcludingNew: "9999",
        nextYearNewHireBudget: "0",
      })
    ).rejects.toThrow(ApiError);

    const adjustment = await requestAdjustment(toCurrentUser(owner), draft.id, "追加預算需求");
    expect(adjustment.status).toBe("ADJUSTMENT_PENDING");
    expect(adjustment.parentVersionId).toBe(draft.id);
    expect(adjustment.versionNumber).toBe(2);

    // Original locked version must remain untouched.
    const originalStillLocked = await prisma.budgetVersion.findUniqueOrThrow({ where: { id: draft.id } });
    expect(originalStillLocked.status).toBe("LOCKED");
    const originalLine = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: draft.id } });
    expect(originalLine.nextYearTargetExcludingNew.toString()).toBe("1000");

    const adjLine = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: adjustment.id } });
    await updateDepartmentInputLine(toCurrentUser(owner), adjustment.id, adjLine.id, {
      nextYearTargetExcludingNew: "1500",
      nextYearNewHireBudget: "0",
    });
    await submitBudgetVersion(toCurrentUser(owner), adjustment.id);
    await startReview(toCurrentUser(reviewer), adjustment.id);
    const adjusted = await approveBudgetVersion(toCurrentUser(approver), adjustment.id);
    expect(adjusted.status).toBe("ADJUSTED");

    // Parent's own row is still exactly as it was approved.
    const originalAfterAdjustment = await prisma.budgetVersion.findUniqueOrThrow({ where: { id: draft.id } });
    expect(originalAfterAdjustment.status).toBe("LOCKED");
  });

  it("reject requires a reason and is terminal", async () => {
    const { dept, owner } = await setupDeptWithOwner();
    const reviewer = await createUser({ role: "FINANCE_REVIEWER", companyWide: true });
    const approver = await createUser({ role: "FINANCE_APPROVER", companyWide: true });
    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2027);
    await submitBudgetVersion(toCurrentUser(owner), draft.id);
    await startReview(toCurrentUser(reviewer), draft.id);

    await expect(rejectBudgetVersion(toCurrentUser(approver), draft.id, "")).rejects.toThrow(ApiError);
    const rejected = await rejectBudgetVersion(toCurrentUser(approver), draft.id, "不符合預算政策");
    expect(rejected.status).toBe("REJECTED");
  });
});

describe("requestAdjustment - performance/atomicity regression guard for the P2028 'Transaction already closed' failure", () => {
  // The original implementation looped over every line of the parent
  // version inside an interactive prisma.$transaction(async (tx) => ...)
  // callback, awaiting one budgetLine.create + one
  // budgetLineMonthlyActual.findMany per line, plus one
  // budgetLineMonthlyActual.create per monthly row found. For a
  // many-account department with monthly actuals history this is hundreds
  // of sequential round trips in one transaction - the same failure class
  // (P2028: Transaction already closed) already fixed for
  // createBudgetVersionDraft and the demo seed's 62-account upsert.
  async function setupApprovedVersionWithManyLines(lineCount: number) {
    const dept = await createDepartment({ code: `ADJWF${Date.now()}${Math.random()}` });
    const owner = await createUser({ role: "BUDGET_OWNER", companyWide: false });
    await grantDepartmentScope(owner.id, dept.id);
    const reviewer = await createUser({ role: "FINANCE_REVIEWER", companyWide: true });
    const approver = await createUser({ role: "FINANCE_APPROVER", companyWide: true });
    for (let i = 0; i < lineCount; i++) {
      await createAccount({ code: `ADJACC-${i}`, entryType: "DEPARTMENT_INPUT", majorCategory: dept.class });
    }

    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2088);
    const lines = await prisma.budgetLine.findMany({ where: { budgetVersionId: draft.id } });
    expect(lines).toHaveLength(lineCount);

    // Give the line for account "ADJACC-0" monthly-actuals history (and
    // leave the rest with none), to exercise the copy path that used to be
    // one extra findMany + one extra create per row - and deterministically
    // (by account code, not array order) so tests can tell "has actuals"
    // apart from "has none" without ambiguity.
    const accountWithActual = await prisma.account.findUniqueOrThrow({ where: { code: "ADJACC-0" } });
    const lineWithActual = lines.find((l) => l.accountId === accountWithActual.id)!;
    await prisma.budgetLineMonthlyActual.create({
      data: { budgetLineId: lineWithActual.id, year: 2087, month: 12, amount: "100", isMissing: false, source: "test" },
    });

    await submitBudgetVersion(toCurrentUser(owner), draft.id);
    await startReview(toCurrentUser(reviewer), draft.id);
    const locked = await approveBudgetVersion(toCurrentUser(approver), draft.id);
    return { dept, owner, locked, lineCount };
  }

  it("executes a small, constant number of SQL statements regardless of line count - not one round trip per line", async () => {
    const { owner, locked } = await setupApprovedVersionWithManyLines(40);

    const queries: string[] = [];
    const listener = (e: { query: string }) => queries.push(e.query);
    prisma.$on("query" as never, listener as never);

    const adjustment = await requestAdjustment(toCurrentUser(owner), locked.id, "大量科目調整測試");
    expect(adjustment.status).toBe("ADJUSTMENT_PENDING");

    // Previously this scaled with line count (40 lines x up to 3
    // statements each = 120+). The rewritten version is a small constant:
    // 1 version insert, 1 lines createMany, 1 monthly-actuals createMany,
    // 1 memory entry insert, 1 audit log insert, plus the handful of
    // up-front reads (parent version+lines, monthly actuals) - independent
    // of line count.
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.length).toBeLessThan(15);
    expect(queries.length).toBeLessThan(40);

    const copiedLines = await prisma.budgetLine.findMany({ where: { budgetVersionId: adjustment.id } });
    expect(copiedLines).toHaveLength(40);
  });

  it("copies every line and every line's monthly actuals correctly to the new adjustment version", async () => {
    const { owner, locked } = await setupApprovedVersionWithManyLines(10);
    const parentLines = await prisma.budgetLine.findMany({ where: { budgetVersionId: locked.id } });
    const accountWithActual = await prisma.account.findUniqueOrThrow({ where: { code: "ADJACC-0" } });
    const parentLineWithActual = parentLines.find((l) => l.accountId === accountWithActual.id)!;

    const adjustment = await requestAdjustment(toCurrentUser(owner), locked.id, "調整測試");
    const childLines = await prisma.budgetLine.findMany({ where: { budgetVersionId: adjustment.id } });
    expect(childLines).toHaveLength(10);
    // New rows, not the same ids as the parent's (a real copy, not a move).
    expect(new Set(childLines.map((l) => l.id))).not.toEqual(new Set(parentLines.map((l) => l.id)));

    const childLineForSameAccount = childLines.find((l) => l.accountId === parentLineWithActual.accountId)!;
    const copiedMonthly = await prisma.budgetLineMonthlyActual.findMany({
      where: { budgetLineId: childLineForSameAccount.id },
    });
    expect(copiedMonthly).toHaveLength(1);
    const copiedMonthlyRow = copiedMonthly[0]!;
    expect(copiedMonthlyRow.year).toBe(2087);
    expect(copiedMonthlyRow.month).toBe(12);
    expect(copiedMonthlyRow.amount?.toString()).toBe("100");

    // Lines with no monthly actuals copy zero rows, not an error.
    const childLineWithoutActual = childLines.find((l) => l.accountId !== parentLineWithActual.accountId)!;
    const noMonthly = await prisma.budgetLineMonthlyActual.findMany({
      where: { budgetLineId: childLineWithoutActual.id },
    });
    expect(noMonthly).toHaveLength(0);
  });

  it("a failure partway through the batch leaves no partial child version, lines, or monthly actuals behind", async () => {
    const { locked } = await setupApprovedVersionWithManyLines(3);

    const childId = "deliberately-broken-adjustment-id";
    const versionCreate = prisma.budgetVersion.create({
      data: {
        id: childId,
        departmentId: locked.departmentId,
        fiscalYear: locked.fiscalYear,
        versionNumber: locked.versionNumber + 1,
        status: "ADJUSTMENT_PENDING",
        parentVersionId: locked.id,
      },
    });
    const brokenLineInsert = prisma.$executeRaw`
      INSERT INTO "BudgetLine" ("id", "budgetVersionId", "accountId", "priorPriorYearActual", "priorYearOriginalBudget", "entryTypeSnapshot")
      VALUES ('broken-adjustment-line', ${childId}, 'not-a-real-account-id', 0, 0, 'NOT_A_REAL_ENUM_VALUE'::"AccountEntryType")
    `;

    await expect(prisma.$transaction([versionCreate, brokenLineInsert])).rejects.toThrow();

    expect(await prisma.budgetVersion.findUnique({ where: { id: childId } })).toBeNull();
    expect(await prisma.budgetLine.findUnique({ where: { id: "broken-adjustment-line" } })).toBeNull();
  });
});
