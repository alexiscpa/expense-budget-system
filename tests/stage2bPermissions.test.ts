import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { createAccount, createUser, toCurrentUser, grantDepartmentScope } from "./helpers/factory";
import { prisma } from "@/lib/prisma";
import { initializeBudgetOwnerDepartments } from "@/lib/masterdata/initializeBudgetOwnerDepartments";
import { startStage2bPreparation } from "@/lib/budget/stage2bDraftService";
import { completePreparation, updateDepartmentInputLine } from "@/lib/budget/lineService";
import { loadStage2bProgress } from "@/lib/reports/stage2bProgress";
import { getAccessibleDepartmentIds } from "@/lib/rbac/permissions";
import { ApiError } from "@/lib/rbac/guard";

beforeEach(async () => {
  await resetDatabase();
});

describe("Stage 2B-2 permission isolation", () => {
  it("a department-scoped user cannot start preparation for a department they are not granted", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    await createAccount({ code: "M1", majorCategory: "M", entryType: "DEPARTMENT_INPUT" });

    const deptA = await prisma.department.findUniqueOrThrow({ where: { code: "10003" } });
    const deptB = await prisma.department.findUniqueOrThrow({ where: { code: "10103" } });
    const userRow = await createUser({ role: "BUDGET_OWNER" });
    await grantDepartmentScope(userRow.id, deptA.id); // only deptA granted
    const user = toCurrentUser(userRow);

    await expect(startStage2bPreparation(user, deptA.id)).resolves.toBeTruthy();
    await expect(startStage2bPreparation(user, deptB.id)).rejects.toThrow(ApiError);
  });

  it("a department-scoped user cannot edit lines on an unauthorized department's version", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    await createAccount({ code: "M1", majorCategory: "M", entryType: "DEPARTMENT_INPUT" });

    const deptB = await prisma.department.findUniqueOrThrow({ where: { code: "10103" } });
    const ownerB = toCurrentUser(await createUser({ role: "BUDGET_OWNER", companyWide: true }));
    const versionB = await startStage2bPreparation(ownerB, deptB.id);
    const lineB = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: versionB.id } });

    const outsiderRow = await createUser({ role: "BUDGET_OWNER" });
    // No department scope granted at all.
    const outsider = toCurrentUser(outsiderRow);

    await expect(
      updateDepartmentInputLine(outsider, versionB.id, lineB.id, { nextYearTargetExcludingNew: "999", nextYearNewHireBudget: "0" })
    ).rejects.toThrow(ApiError);

    const unchanged = await prisma.budgetLine.findUniqueOrThrow({ where: { id: lineB.id } });
    expect(unchanged.nextYearTargetExcludingNew.toString()).toBe("0");
    expect(unchanged.inputConfirmedAt).toBeNull();
  });

  it("getAccessibleDepartmentIds correctly scopes a department-editor to only their granted departments among the 45", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    const deptA = await prisma.department.findUniqueOrThrow({ where: { code: "10003" } });
    const userRow = await createUser({ role: "DEPARTMENT_EDITOR" });
    await grantDepartmentScope(userRow.id, deptA.id);
    const user = toCurrentUser(userRow);

    const accessible = await getAccessibleDepartmentIds(user);
    expect(accessible).toEqual([deptA.id]);
  });

  it("company-wide finance/admin roles see all 45 rows via loadStage2bProgress regardless of UserDepartmentScope", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    const financeReviewer = await createUser({ role: "FINANCE_REVIEWER", companyWide: true });
    const accessible = await getAccessibleDepartmentIds(toCurrentUser(financeReviewer));
    expect(accessible).toBeNull(); // null = unrestricted, per getAccessibleDepartmentIds's own contract

    const { rows } = await loadStage2bProgress();
    expect(rows.length).toBe(45);
  });

  it("completePreparation is refused for a user with no access to the version's department", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    await createAccount({ code: "M1", majorCategory: "M", entryType: "DEPARTMENT_INPUT" });
    const dept = await prisma.department.findUniqueOrThrow({ where: { code: "10003" } });
    const owner = toCurrentUser(await createUser({ role: "BUDGET_OWNER", companyWide: true }));
    const version = await startStage2bPreparation(owner, dept.id);

    const outsider = toCurrentUser(await createUser({ role: "BUDGET_OWNER" }));
    await expect(completePreparation(outsider, version.id)).rejects.toThrow(ApiError);
  });

  it("initializeBudgetOwnerDepartments requires master_data.import capability (SYSTEM_ADMIN only)", async () => {
    const nonAdmin = toCurrentUser(await createUser({ role: "BUDGET_OWNER", companyWide: true }));
    // The service function itself has no capability check (it's called
    // from the API route, which enforces requireCapability before
    // invoking it) - this test documents that the route-level guard is
    // the enforcement point, by confirming the underlying capability
    // matrix does not grant BUDGET_OWNER this capability.
    const { hasCapability } = await import("@/lib/rbac/permissions");
    expect(hasCapability(nonAdmin.role, "master_data.import")).toBe(false);
    expect(hasCapability("SYSTEM_ADMIN", "master_data.import")).toBe(true);
  });
});
