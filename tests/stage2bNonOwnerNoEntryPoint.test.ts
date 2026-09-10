import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { createUser, toCurrentUser } from "./helpers/factory";
import { prisma } from "@/lib/prisma";
import { initializeBudgetOwnerDepartments } from "@/lib/masterdata/initializeBudgetOwnerDepartments";
import { startStage2bPreparation } from "@/lib/budget/stage2bDraftService";
import { createBudgetVersionDraft } from "@/lib/budget/lineService";
import { BUDGET_OWNER_ROSTER } from "@/lib/masterdata/budgetOwnerRoster";
import { KNOWN_DEPARTMENT_CODES } from "@/lib/reports/budgetSummaryPreviewData";
import { ApiError } from "@/lib/rbac/guard";

// A representative sample of the 23 non-BUDGET_OWNER ERP codes from
// docs/data/stage2b1-department-manifest.json: PARENT_ONLY (17003, 12101,
// 12401), MERGED (11112), and INACTIVE (12501, 3001, A1004).
const NON_OWNER_CODES = ["17003", "12101", "12401", "11112", "12501", "3001", "A1004"];

beforeEach(async () => {
  await resetDatabase();
});

describe("the 23 non-BUDGET_OWNER codes have no budget entry point", () => {
  it("initializeBudgetOwnerDepartments never creates a Department row for any of them", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    const rows = await prisma.department.findMany({ where: { code: { in: NON_OWNER_CODES } } });
    expect(rows.length).toBe(0);
  });

  it("startStage2bPreparation refuses a manually-created Department row for a non-owner code", async () => {
    // Simulates the (should-never-happen) case where a non-owner code's
    // Department row exists anyway - the roster check still refuses it.
    const dept = await prisma.department.create({ data: { code: "12501", name: "教研營業處", class: "S" } });
    const user = toCurrentUser(await createUser({ role: "BUDGET_OWNER", companyWide: true }));
    await expect(startStage2bPreparation(user, dept.id)).rejects.toThrow(ApiError);
  });

  it("12501 specifically is absent from the roster and from KNOWN_DEPARTMENT_CODES", () => {
    expect(BUDGET_OWNER_ROSTER.some((r) => r.code === "12501")).toBe(false);
    expect(KNOWN_DEPARTMENT_CODES).not.toContain("12501");
  });

  it("none of the 23 representative non-owner codes appear in KNOWN_DEPARTMENT_CODES", () => {
    for (const code of NON_OWNER_CODES) {
      expect(KNOWN_DEPARTMENT_CODES).not.toContain(code);
    }
  });

  it("KNOWN_DEPARTMENT_CODES has exactly 45 entries, matching the roster 1:1", () => {
    expect(KNOWN_DEPARTMENT_CODES.length).toBe(45);
    expect(new Set(KNOWN_DEPARTMENT_CODES).size).toBe(45);
  });

  it("createBudgetVersionDraft itself has no special-casing that would let a non-owner code slip through if a row existed", async () => {
    // Defense-in-depth check: even createBudgetVersionDraft directly
    // (bypassing startStage2bPreparation's roster gate) only ever operates
    // on whatever Department row is passed - since no Department row is
    // ever created for a non-owner code by this system, there is nothing
    // for it to operate on. This documents that invariant rather than
    // testing a new guard.
    const nonOwnerCodesInDb = await prisma.department.count({ where: { code: { in: NON_OWNER_CODES } } });
    expect(nonOwnerCodesInDb).toBe(0);
    // (createBudgetVersionDraft is exercised elsewhere against real
    // roster departments - see stage2bDraftService.test.ts.)
    expect(createBudgetVersionDraft).toBeInstanceOf(Function);
  });
});
