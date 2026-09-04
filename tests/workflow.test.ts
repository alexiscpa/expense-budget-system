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
