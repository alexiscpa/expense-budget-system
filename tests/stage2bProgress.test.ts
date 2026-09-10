import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { createAccount, createUser, toCurrentUser } from "./helpers/factory";
import { prisma } from "@/lib/prisma";
import { initializeBudgetOwnerDepartments } from "@/lib/masterdata/initializeBudgetOwnerDepartments";
import { startStage2bPreparation } from "@/lib/budget/stage2bDraftService";
import { updateDepartmentInputLine, completePreparation } from "@/lib/budget/lineService";
import { updateBudgetYearHeadcount } from "@/lib/budget/headcountService";
import { submitBudgetVersion, startReview, returnBudgetVersion, approveBudgetVersion, resubmitBudgetVersion } from "@/lib/workflow/actions";
import { loadStage2bProgress } from "@/lib/reports/stage2bProgress";
import { BUDGET_OWNER_ROSTER_SIZE } from "@/lib/masterdata/budgetOwnerRoster";

beforeEach(async () => {
  await resetDatabase();
});

describe("loadStage2bProgress", () => {
  it("reports all 45 as NOT_STARTED before any master-data init or draft creation, denominator fixed at 45", async () => {
    const { rows, summary } = await loadStage2bProgress();
    expect(rows.length).toBe(BUDGET_OWNER_ROSTER_SIZE);
    expect(summary.totalDepartments).toBe(45);
    expect(summary.notStarted).toBe(45);
    expect(summary.startedPercent).toBe(0);
    expect(summary.completedPreparationPercent).toBe(0);
    expect(summary.submittedPercent).toBe(0);
    // Every row shows "no data" (null), never a fabricated 0.
    for (const row of rows) {
      expect(row.total2026).toBeNull();
      expect(row.total2027).toBeNull();
      expect(row.completionPercent).toBeNull();
    }
  });

  it("moves a department through DRAFT_EMPTY -> IN_PROGRESS -> READY_TO_SUBMIT -> SUBMITTED -> UNDER_REVIEW -> RETURNED -> APPROVED", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    await createAccount({ code: "M1", majorCategory: "M", entryType: "DEPARTMENT_INPUT" });
    const dept = await prisma.department.findUniqueOrThrow({ where: { code: "10003" } });
    const owner = toCurrentUser(await createUser({ role: "BUDGET_OWNER", companyWide: true }));

    let { rows } = await loadStage2bProgress();
    expect(rows.find((r) => r.code === "10003")!.status).toBe("NOT_STARTED");

    const version = await startStage2bPreparation(owner, dept.id);
    rows = (await loadStage2bProgress()).rows;
    expect(rows.find((r) => r.code === "10003")!.status).toBe("DRAFT_EMPTY");

    const lines = await prisma.budgetLine.findMany({ where: { budgetVersionId: version.id } });
    await updateDepartmentInputLine(owner, version.id, lines[0]!.id, { nextYearTargetExcludingNew: "0", nextYearNewHireBudget: "0" });
    rows = (await loadStage2bProgress()).rows;
    expect(rows.find((r) => r.code === "10003")!.status).toBe("IN_PROGRESS");

    await updateBudgetYearHeadcount(owner, version.id, "3");
    await completePreparation(owner, version.id);
    rows = (await loadStage2bProgress()).rows;
    expect(rows.find((r) => r.code === "10003")!.status).toBe("READY_TO_SUBMIT");

    await submitBudgetVersion(owner, version.id);
    rows = (await loadStage2bProgress()).rows;
    expect(rows.find((r) => r.code === "10003")!.status).toBe("SUBMITTED");

    const reviewer = toCurrentUser(await createUser({ role: "FINANCE_REVIEWER", companyWide: true }));
    await startReview(reviewer, version.id);
    rows = (await loadStage2bProgress()).rows;
    expect(rows.find((r) => r.code === "10003")!.status).toBe("UNDER_REVIEW");

    await returnBudgetVersion(reviewer, version.id, "需修正");
    rows = (await loadStage2bProgress()).rows;
    expect(rows.find((r) => r.code === "10003")!.status).toBe("RETURNED");

    // Re-confirm and re-submit through to approval.
    await updateBudgetYearHeadcount(owner, version.id, "3");
    await completePreparation(owner, version.id);
    await resubmitBudgetVersion(owner, version.id);
    const approver = toCurrentUser(await createUser({ role: "FINANCE_APPROVER", companyWide: true }));
    await startReview(reviewer, version.id);
    await approveBudgetVersion(approver, version.id);
    rows = (await loadStage2bProgress()).rows;
    expect(rows.find((r) => r.code === "10003")!.status).toBe("APPROVED");
  });

  it("counts a confirmed explicit 0 in completionPercent, and never counts an unconfirmed default 0", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    await createAccount({ code: "M1", majorCategory: "M", entryType: "DEPARTMENT_INPUT" });
    await createAccount({ code: "M2", majorCategory: "M", entryType: "DEPARTMENT_INPUT" });
    const dept = await prisma.department.findUniqueOrThrow({ where: { code: "10003" } });
    const owner = toCurrentUser(await createUser({ role: "BUDGET_OWNER", companyWide: true }));
    const version = await startStage2bPreparation(owner, dept.id);
    const lines = await prisma.budgetLine.findMany({ where: { budgetVersionId: version.id } });

    let progress = (await loadStage2bProgress()).rows.find((r) => r.code === "10003")!;
    expect(progress.confirmedLineCount).toBe(0);
    expect(progress.applicableLineCount).toBe(2);
    expect(progress.completionPercent).toBe(0);

    await updateDepartmentInputLine(owner, version.id, lines[0]!.id, { nextYearTargetExcludingNew: "0", nextYearNewHireBudget: "0" });
    progress = (await loadStage2bProgress()).rows.find((r) => r.code === "10003")!;
    expect(progress.confirmedLineCount).toBe(1);
    expect(progress.completionPercent).toBe(50);
  });

  it("startedPercent/completedPreparationPercent/submittedPercent are three distinct numbers, not one blended figure", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    await createAccount({ code: "M1", majorCategory: "M", entryType: "DEPARTMENT_INPUT" });
    const dept = await prisma.department.findUniqueOrThrow({ where: { code: "10003" } });
    const owner = toCurrentUser(await createUser({ role: "BUDGET_OWNER", companyWide: true }));
    await startStage2bPreparation(owner, dept.id); // started, but not completed or submitted

    const { summary } = await loadStage2bProgress();
    expect(summary.startedPercent).toBeGreaterThan(0);
    expect(summary.completedPreparationPercent).toBe(0);
    expect(summary.submittedPercent).toBe(0);
    expect(summary.startedPercent).not.toBe(summary.completedPreparationPercent);
  });

  it("denominator stays 45 even when master-data init has not been run at all (rows show NOT_STARTED, not an error)", async () => {
    const { rows, summary } = await loadStage2bProgress();
    expect(rows.length).toBe(45);
    expect(summary.totalDepartments).toBe(45);
    expect(summary.notYetInSystem).toBe(45);
  });
});
