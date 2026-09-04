import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { createDepartment, createUser, createAccount, grantDepartmentScope, toCurrentUser } from "./helpers/factory";
import { createBudgetVersionDraft, updateDepartmentInputLine } from "@/lib/budget/lineService";
import { submitBudgetVersion, startReview, approveBudgetVersion, requestAdjustment } from "@/lib/workflow/actions";
import { runConsistencyCheck } from "@/lib/reports/consistencyCheck";
import { exportApprovedBudgetVersion } from "@/lib/excel/exportBudgetLines";
import { ApiError } from "@/lib/rbac/guard";
import { prisma } from "@/lib/prisma";

beforeEach(async () => {
  await resetDatabase();
});

async function approveOneLine(fiscalYear: number, amount: string) {
  const dept = await createDepartment();
  const owner = await createUser({ role: "BUDGET_OWNER", companyWide: false });
  await grantDepartmentScope(owner.id, dept.id);
  const reviewer = await createUser({ role: "FINANCE_REVIEWER", companyWide: true });
  const approver = await createUser({ role: "FINANCE_APPROVER", companyWide: true });
  await createAccount({ entryType: "DEPARTMENT_INPUT", majorCategory: dept.class });

  const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, fiscalYear);
  const line = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: draft.id } });
  await updateDepartmentInputLine(toCurrentUser(owner), draft.id, line.id, {
    nextYearTargetExcludingNew: amount,
    nextYearNewHireBudget: "0",
  });
  await submitBudgetVersion(toCurrentUser(owner), draft.id);
  await startReview(toCurrentUser(reviewer), draft.id);
  const approved = await approveBudgetVersion(toCurrentUser(approver), draft.id);
  return { version: approved, approver, owner, reviewer };
}

describe("bidirectional department/account consistency check", () => {
  it("passes when department totals equal account totals (same underlying figures, two aggregation angles)", async () => {
    const year = 2101;
    await approveOneLine(year, "5000");
    await approveOneLine(year, "3000");

    const run = await runConsistencyCheck(null, year);
    expect(run.passed).toBe(true);
    expect(run.difference.toString()).toBe("0");
    expect(run.departmentTotal.toString()).toBe("8000");
    expect(run.accountTotal.toString()).toBe("8000");
  });

  it("persists a full, traceable detail record (per-department and per-account breakdown) on every run", async () => {
    const year = 2102;
    await approveOneLine(year, "1000");
    const run = await runConsistencyCheck(null, year);
    const detail = run.detail as { departmentTotals: unknown[]; accountTotals: unknown[]; message: string };
    expect(detail.departmentTotals.length).toBeGreaterThan(0);
    expect(detail.accountTotals.length).toBeGreaterThan(0);
    expect(typeof detail.message).toBe("string");

    const persisted = await prisma.consistencyCheckRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(persisted.fiscalYear).toBe(year);
  });

  it("counts only the latest approved version per department (a completed adjustment supersedes the original)", async () => {
    const year = 2105;
    const { version, owner, reviewer, approver } = await approveOneLine(year, "1000");

    const firstCheck = await runConsistencyCheck(null, year);
    expect(firstCheck.departmentTotal.toString()).toBe("1000");

    const adjustment = await requestAdjustment(toCurrentUser(owner), version.id, "追加預算");
    const adjLine = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: adjustment.id } });
    await updateDepartmentInputLine(toCurrentUser(owner), adjustment.id, adjLine.id, {
      nextYearTargetExcludingNew: "1800",
      nextYearNewHireBudget: "0",
    });
    await submitBudgetVersion(toCurrentUser(owner), adjustment.id);
    await startReview(toCurrentUser(reviewer), adjustment.id);
    await approveBudgetVersion(toCurrentUser(approver), adjustment.id);

    const secondCheck = await runConsistencyCheck(null, year);
    expect(secondCheck.departmentTotal.toString()).toBe("1800");
  });
});

describe("official export only includes approved (locked) versions", () => {
  it("refuses to export a version that has not been approved", async () => {
    const dept = await createDepartment();
    const owner = await createUser({ role: "BUDGET_OWNER", companyWide: false });
    await grantDepartmentScope(owner.id, dept.id);
    const finance = await createUser({ role: "FINANCE_APPROVER", companyWide: true });
    await createAccount({ entryType: "DEPARTMENT_INPUT", majorCategory: dept.class });
    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2027);

    await expect(exportApprovedBudgetVersion(toCurrentUser(finance), draft.id)).rejects.toThrow(ApiError);
  });

  it("exports a LOCKED version successfully and logs the export", async () => {
    const { version, approver } = await approveOneLine(2103, "2500");
    const buffer = await exportApprovedBudgetVersion(toCurrentUser(approver), version.id);
    expect(buffer.byteLength).toBeGreaterThan(0);

    const logs = await prisma.auditLog.findMany({ where: { action: "REPORT_EXPORTED", entityId: version.id } });
    expect(logs).toHaveLength(1);
  });
});
