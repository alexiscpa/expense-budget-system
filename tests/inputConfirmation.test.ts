import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { createDepartment, createAccount, createUser, toCurrentUser, grantDepartmentScope } from "./helpers/factory";
import { prisma } from "@/lib/prisma";
import { createBudgetVersionDraft, updateDepartmentInputLine, completePreparation } from "@/lib/budget/lineService";
import { updateBudgetYearHeadcount } from "@/lib/budget/headcountService";
import { returnBudgetVersion, startReview, submitBudgetVersion, withdrawBudgetSubmission } from "@/lib/workflow/actions";
import { ApiError } from "@/lib/rbac/guard";

beforeEach(async () => {
  await resetDatabase();
});

async function setupDraft() {
  const dept = await createDepartment({ code: "D1", class: "M" });
  await createAccount({ code: "A1", majorCategory: "M", entryType: "DEPARTMENT_INPUT" });
  const owner = await createUser({ role: "BUDGET_OWNER" });
  await grantDepartmentScope(owner.id, dept.id);
  const user = toCurrentUser(owner);
  const version = await createBudgetVersionDraft(user, dept.id, 2027);
  const lines = await prisma.budgetLine.findMany({ where: { budgetVersionId: version.id } });
  return { dept, user, version, line: lines[0]! };
}

describe("BudgetLine.inputConfirmedAt", () => {
  it("is null on a freshly created draft line (blank, not a fake 0)", async () => {
    const { line } = await setupDraft();
    expect(line.inputConfirmedAt).toBeNull();
    expect(line.inputConfirmedById).toBeNull();
    expect(line.nextYearTargetExcludingNew.toString()).toBe("0");
  });

  it("is set when the user explicitly enters 0 (distinct from an unconfirmed default 0)", async () => {
    const { user, version, line } = await setupDraft();
    const updated = await updateDepartmentInputLine(user, version.id, line.id, {
      nextYearTargetExcludingNew: "0",
      nextYearNewHireBudget: "0",
    });
    expect(updated.nextYearTargetExcludingNew.toString()).toBe("0");
    expect(updated.inputConfirmedAt).not.toBeNull();
    expect(updated.inputConfirmedById).toBe(user.id);
  });

  it("is set when the user enters a non-zero amount", async () => {
    const { user, version, line } = await setupDraft();
    const updated = await updateDepartmentInputLine(user, version.id, line.id, {
      nextYearTargetExcludingNew: "12345",
      nextYearNewHireBudget: "0",
    });
    expect(updated.nextYearTargetExcludingNew.toString()).toBe("12345");
    expect(updated.inputConfirmedAt).not.toBeNull();
  });

  it("stays set (refreshed) on a second save with an unchanged value", async () => {
    const { user, version, line } = await setupDraft();
    const first = await updateDepartmentInputLine(user, version.id, line.id, {
      nextYearTargetExcludingNew: "500",
      nextYearNewHireBudget: "0",
    });
    const second = await updateDepartmentInputLine(user, version.id, line.id, {
      nextYearTargetExcludingNew: "500",
      nextYearNewHireBudget: "0",
    });
    expect(second.inputConfirmedAt).not.toBeNull();
    expect(second.inputConfirmedAt!.getTime()).toBeGreaterThanOrEqual(first.inputConfirmedAt!.getTime());
  });
});

describe("BudgetVersion.headcountConfirmedAt", () => {
  it("is null until the preparer saves a headcount", async () => {
    const { version } = await setupDraft();
    expect(version.headcountConfirmedAt).toBeNull();
  });

  it("is set after saving, even when the value equals the existing default", async () => {
    const { user, version } = await setupDraft();
    const updated = await updateBudgetYearHeadcount(user, version.id, "0");
    expect(updated.headcountConfirmedAt).not.toBeNull();
  });
});

describe("completePreparation", () => {
  it("refuses when headcount is unconfirmed", async () => {
    const { user, version, line } = await setupDraft();
    await updateDepartmentInputLine(user, version.id, line.id, { nextYearTargetExcludingNew: "0", nextYearNewHireBudget: "0" });
    await expect(completePreparation(user, version.id)).rejects.toThrow(ApiError);
  });

  it("refuses when an editable line is still unconfirmed", async () => {
    const { user, version } = await setupDraft();
    await updateBudgetYearHeadcount(user, version.id, "5");
    await expect(completePreparation(user, version.id)).rejects.toThrow(ApiError);
  });

  it("succeeds once headcount and every editable line are confirmed", async () => {
    const { user, version, line } = await setupDraft();
    await updateBudgetYearHeadcount(user, version.id, "5");
    await updateDepartmentInputLine(user, version.id, line.id, { nextYearTargetExcludingNew: "0", nextYearNewHireBudget: "0" });
    const completed = await completePreparation(user, version.id);
    expect(completed.preparationCompletedAt).not.toBeNull();
    expect(completed.preparationCompletedById).toBe(user.id);
  });

  it("is cleared when a line is edited again after completion", async () => {
    const { user, version, line } = await setupDraft();
    await updateBudgetYearHeadcount(user, version.id, "5");
    await updateDepartmentInputLine(user, version.id, line.id, { nextYearTargetExcludingNew: "0", nextYearNewHireBudget: "0" });
    await completePreparation(user, version.id);

    const reEdited = await updateDepartmentInputLine(user, version.id, line.id, { nextYearTargetExcludingNew: "999", nextYearNewHireBudget: "0" });
    expect(reEdited).toBeTruthy();
    const refreshed = await prisma.budgetVersion.findUnique({ where: { id: version.id } });
    expect(refreshed!.preparationCompletedAt).toBeNull();
    expect(refreshed!.preparationCompletedById).toBeNull();
  });

  it("is NOT cleared by a no-op re-save of the same value", async () => {
    const { user, version, line } = await setupDraft();
    await updateBudgetYearHeadcount(user, version.id, "5");
    await updateDepartmentInputLine(user, version.id, line.id, { nextYearTargetExcludingNew: "0", nextYearNewHireBudget: "0" });
    await completePreparation(user, version.id);

    await updateDepartmentInputLine(user, version.id, line.id, { nextYearTargetExcludingNew: "0", nextYearNewHireBudget: "0" });
    const refreshed = await prisma.budgetVersion.findUnique({ where: { id: version.id } });
    expect(refreshed!.preparationCompletedAt).not.toBeNull();
  });

  it("is preserved through withdraw (SUBMITTED -> DRAFT) since no content changed", async () => {
    const { user, version, line } = await setupDraft();
    await updateBudgetYearHeadcount(user, version.id, "5");
    await updateDepartmentInputLine(user, version.id, line.id, { nextYearTargetExcludingNew: "0", nextYearNewHireBudget: "0" });
    await completePreparation(user, version.id);
    await submitBudgetVersion(user, version.id);

    const withdrawn = await withdrawBudgetSubmission(user, version.id);
    expect(withdrawn.status).toBe("DRAFT");
    expect(withdrawn.preparationCompletedAt).not.toBeNull();
  });

  it("is cleared when the version is returned by finance", async () => {
    const { user, version, line } = await setupDraft();
    await updateBudgetYearHeadcount(user, version.id, "5");
    await updateDepartmentInputLine(user, version.id, line.id, { nextYearTargetExcludingNew: "0", nextYearNewHireBudget: "0" });
    await completePreparation(user, version.id);
    await submitBudgetVersion(user, version.id);

    const reviewer = toCurrentUser(await createUser({ role: "FINANCE_REVIEWER", companyWide: true }));
    const reviewed = await startReview(reviewer, version.id);
    expect(reviewed.status).toBe("UNDER_REVIEW");
    const returned = await returnBudgetVersion(reviewer, version.id, "金額需要調整");
    expect(returned.status).toBe("RETURNED");
    expect(returned.preparationCompletedAt).toBeNull();
    expect(returned.preparationCompletedById).toBeNull();
  });
});

describe("migration/seed safety for confirmation fields", () => {
  it("createBudgetVersionDraft never sets inputConfirmedAt/headcountConfirmedAt on fresh lines", async () => {
    const { version } = await setupDraft();
    const lines = await prisma.budgetLine.findMany({ where: { budgetVersionId: version.id } });
    expect(lines.every((l) => l.inputConfirmedAt === null)).toBe(true);
    const freshVersion = await prisma.budgetVersion.findUnique({ where: { id: version.id } });
    expect(freshVersion!.headcountConfirmedAt).toBeNull();
    expect(freshVersion!.preparationCompletedAt).toBeNull();
  });
});
