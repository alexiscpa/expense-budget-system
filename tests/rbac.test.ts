import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { createDepartment, createUser, grantDepartmentScope, toCurrentUser } from "./helpers/factory";
import { hasCapability, getAccessibleDepartmentIds, canAccessDepartment } from "@/lib/rbac/permissions";
import { requireDepartmentAccess, requireCapability, ApiError } from "@/lib/rbac/guard";

beforeEach(async () => {
  await resetDatabase();
});

describe("role capability matrix", () => {
  it("grants finance approval only to FINANCE_APPROVER", () => {
    expect(hasCapability("FINANCE_APPROVER", "budget.approve")).toBe(true);
    expect(hasCapability("FINANCE_REVIEWER", "budget.approve")).toBe(false);
    expect(hasCapability("DEPARTMENT_EDITOR", "budget.approve")).toBe(false);
    expect(hasCapability("BUDGET_OWNER", "budget.approve")).toBe(false);
  });

  it("never grants a READ_ONLY user any write capability", () => {
    expect(hasCapability("READ_ONLY", "budget.edit_own_department")).toBe(false);
    expect(hasCapability("READ_ONLY", "budget.approve")).toBe(false);
    expect(hasCapability("READ_ONLY", "master_data.import")).toBe(false);
  });

  it("never lets AUDITOR write budget data (read-only oversight role)", () => {
    expect(hasCapability("AUDITOR", "budget.edit_own_department")).toBe(false);
    expect(hasCapability("AUDITOR", "budget.approve")).toBe(false);
    expect(hasCapability("AUDITOR", "audit.view")).toBe(true);
  });
});

describe("department scoping / IDOR prevention", () => {
  it("a department-scoped user only sees departments explicitly granted, never all", async () => {
    const deptA = await createDepartment({ code: "DA" });
    const deptB = await createDepartment({ code: "DB" });
    const owner = await createUser({ role: "BUDGET_OWNER", companyWide: false });
    await grantDepartmentScope(owner.id, deptA.id);

    const ids = await getAccessibleDepartmentIds(toCurrentUser(owner));
    expect(ids).toEqual([deptA.id]);
    expect(ids).not.toContain(deptB.id);
  });

  it("company-wide roles are unrestricted (null = all departments)", async () => {
    const finance = await createUser({ role: "FINANCE_APPROVER", companyWide: true });
    const ids = await getAccessibleDepartmentIds(toCurrentUser(finance));
    expect(ids).toBeNull();
  });

  it("rejects cross-department access attempts with a generic, non-leaking message", async () => {
    const deptA = await createDepartment({ code: "DA2" });
    const deptB = await createDepartment({ code: "DB2" });
    const owner = await createUser({ role: "BUDGET_OWNER", companyWide: false });
    await grantDepartmentScope(owner.id, deptA.id);

    expect(await canAccessDepartment(toCurrentUser(owner), deptA.id)).toBe(true);
    expect(await canAccessDepartment(toCurrentUser(owner), deptB.id)).toBe(false);

    await expect(requireDepartmentAccess(toCurrentUser(owner), deptB.id)).rejects.toThrow(ApiError);
    try {
      await requireDepartmentAccess(toCurrentUser(owner), deptB.id);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(403);
      expect((err as ApiError).message).not.toContain(deptB.id); // no ID leakage
    }
  });

  it("denies an action outright when the role lacks the capability, regardless of department", async () => {
    const readOnly = await createUser({ role: "READ_ONLY", companyWide: true });
    await expect(requireCapability(toCurrentUser(readOnly), "budget.approve")).rejects.toThrow(ApiError);
  });
});
