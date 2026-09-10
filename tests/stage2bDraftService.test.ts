import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { createAccount, createUser, toCurrentUser, grantDepartmentScope } from "./helpers/factory";
import { prisma } from "@/lib/prisma";
import { initializeBudgetOwnerDepartments } from "@/lib/masterdata/initializeBudgetOwnerDepartments";
import { startStage2bPreparation, STAGE2B_BUDGET_FISCAL_YEAR } from "@/lib/budget/stage2bDraftService";
import { createBudgetVersionDraft } from "@/lib/budget/lineService";
import { ApiError } from "@/lib/rbac/guard";

beforeEach(async () => {
  await resetDatabase();
});

describe("startStage2bPreparation", () => {
  it("creates a DRAFT version with every applicable account fully editable (no FORMULA/NOT_BUDGETED/尚未設定)", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);

    // Deliberately unconfigured FORMULA account and a NOT_BUDGETED account,
    // both of class S - would normally lock/NOT_CONFIGURE a real
    // department's line for these.
    await createAccount({ code: "SF1", majorCategory: "S", entryType: "FORMULA", formulaKey: null });
    await createAccount({ code: "SN1", majorCategory: "S", entryType: "NOT_BUDGETED" });
    await createAccount({ code: "SD1", majorCategory: "S", entryType: "DEPARTMENT_INPUT" });

    const dept = await prisma.department.findUniqueOrThrow({ where: { code: "12001" } }); // S class, no rollup parent
    const owner = toCurrentUser(await createUser({ role: "BUDGET_OWNER", companyWide: true }));

    const version = await startStage2bPreparation(owner, dept.id);
    expect(version.fiscalYear).toBe(STAGE2B_BUDGET_FISCAL_YEAR);

    const lines = await prisma.budgetLine.findMany({ where: { budgetVersionId: version.id }, include: { account: true } });
    expect(lines.length).toBe(3);
    for (const line of lines) {
      expect(line.isLocked).toBe(false);
      expect(line.formulaStatus).not.toBe("NOT_CONFIGURED");
      expect(line.entryTypeSnapshot).toBe("DEPARTMENT_INPUT");
      // Every line starts unconfirmed/blank - no fabricated amount.
      expect(line.inputConfirmedAt).toBeNull();
      expect(line.nextYearTargetExcludingNew.toString()).toBe("0");
    }
  });

  it("refuses a department outside the 45-department roster", async () => {
    const dept = await prisma.department.create({ data: { code: "OUTSIDE1", name: "非名冊部門", class: "M" } });
    const owner = toCurrentUser(await createUser({ role: "BUDGET_OWNER", companyWide: true }));
    await expect(startStage2bPreparation(owner, dept.id)).rejects.toThrow(ApiError);
  });

  it("refuses to create a second 2027 draft for the same department (idempotent guard)", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    await createAccount({ code: "M1", majorCategory: "M", entryType: "DEPARTMENT_INPUT" });
    const dept = await prisma.department.findUniqueOrThrow({ where: { code: "10003" } });
    const owner = toCurrentUser(await createUser({ role: "BUDGET_OWNER", companyWide: true }));

    await startStage2bPreparation(owner, dept.id);
    await expect(startStage2bPreparation(owner, dept.id)).rejects.toThrow(ApiError);
  });

  it("does not create a version until explicitly started (NOT_STARTED has zero BudgetVersion rows)", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    const count = await prisma.budgetVersion.count();
    expect(count).toBe(0);
  });

  it("keeps 11122/11132 and 12311/12321 as separate departments/versions with independent lines", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    await createAccount({ code: "R1", majorCategory: "R", entryType: "DEPARTMENT_INPUT" });
    await createAccount({ code: "S1", majorCategory: "S", entryType: "DEPARTMENT_INPUT" });
    const owner = toCurrentUser(await createUser({ role: "BUDGET_OWNER", companyWide: true }));

    const d11122 = await prisma.department.findUniqueOrThrow({ where: { code: "11122" } });
    const d11132 = await prisma.department.findUniqueOrThrow({ where: { code: "11132" } });
    const v1 = await startStage2bPreparation(owner, d11122.id);
    const v2 = await startStage2bPreparation(owner, d11132.id);
    expect(v1.id).not.toBe(v2.id);
    expect(v1.departmentId).not.toBe(v2.departmentId);

    const d12311 = await prisma.department.findUniqueOrThrow({ where: { code: "12311" } });
    const d12321 = await prisma.department.findUniqueOrThrow({ where: { code: "12321" } });
    const v3 = await startStage2bPreparation(owner, d12311.id);
    const v4 = await startStage2bPreparation(owner, d12321.id);
    expect(v3.id).not.toBe(v4.id);
  });

  it("13211 and 16124 each get exactly one 2027 BudgetVersion, routed to their manifest-assigned single class", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    await createAccount({ code: "S2", majorCategory: "S", entryType: "DEPARTMENT_INPUT" });
    await createAccount({ code: "P2", majorCategory: "P", entryType: "DEPARTMENT_INPUT" });
    const owner = toCurrentUser(await createUser({ role: "BUDGET_OWNER", companyWide: true }));

    const d13211 = await prisma.department.findUniqueOrThrow({ where: { code: "13211" } });
    expect(d13211.class).toBe("S");
    const v13211 = await startStage2bPreparation(owner, d13211.id);
    const lines13211 = await prisma.budgetLine.findMany({ where: { budgetVersionId: v13211.id }, include: { account: true } });
    expect(lines13211.every((l) => l.account.majorCategory === "S")).toBe(true);
    // A second version for the same department/year is refused, so
    // "生-影安" being a second class never produces a second BudgetVersion
    // or a second aggregation for 13211.
    await expect(createBudgetVersionDraft(owner, d13211.id, STAGE2B_BUDGET_FISCAL_YEAR)).rejects.toThrow(ApiError);

    const d16124 = await prisma.department.findUniqueOrThrow({ where: { code: "16124" } });
    expect(d16124.class).toBe("P");
    const v16124 = await startStage2bPreparation(owner, d16124.id);
    const lines16124 = await prisma.budgetLine.findMany({ where: { budgetVersionId: v16124.id }, include: { account: true } });
    expect(lines16124.every((l) => l.account.majorCategory === "P")).toBe(true);
    const versionCount = await prisma.budgetVersion.count({ where: { departmentId: d16124.id } });
    expect(versionCount).toBe(1);
  });
});
