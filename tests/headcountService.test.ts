import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { createUser, createDepartment, grantDepartmentScope, toCurrentUser } from "./helpers/factory";
import { prisma } from "@/lib/prisma";
import { upsertBudgetYearHeadcount } from "@/lib/budget/headcountService";
import { ApiError } from "@/lib/rbac/guard";

beforeEach(async () => {
  await resetDatabase();
});

async function setupDraft() {
  const dept = await createDepartment({ code: "H001", name: "測試部門", class: "M" });
  const owner = await createUser({ role: "BUDGET_OWNER" });
  await grantDepartmentScope(owner.id, dept.id);
  await prisma.departmentHeadcount.create({
    data: { departmentId: dept.id, fiscalYear: 2026, headcount: 11, sourceType: "STAGE2A_TEST_SEED_2026_PROJECTION", isTestData: true },
  });
  await prisma.budgetVersion.create({
    data: { departmentId: dept.id, fiscalYear: 2027, versionNumber: 1, status: "DRAFT", preparedById: owner.id },
  });
  return { dept, owner };
}

describe("upsertBudgetYearHeadcount", () => {
  it("creates the 2027 headcount row without altering the existing 2026 row for the same department", async () => {
    const { dept, owner } = await setupDraft();

    await upsertBudgetYearHeadcount(toCurrentUser(owner), dept.id, 2027, 13);

    const y2027 = await prisma.departmentHeadcount.findUniqueOrThrow({
      where: { departmentId_fiscalYear: { departmentId: dept.id, fiscalYear: 2027 } },
    });
    expect(y2027.headcount).toBe(13);
    expect(y2027.sourceType).toBe("USER_INPUT");

    const y2026 = await prisma.departmentHeadcount.findUniqueOrThrow({
      where: { departmentId_fiscalYear: { departmentId: dept.id, fiscalYear: 2026 } },
    });
    expect(y2026.headcount).toBe(11);
    expect(y2026.sourceType).toBe("STAGE2A_TEST_SEED_2026_PROJECTION");
  });

  it("updates an existing headcount row in place (upsert) rather than creating a duplicate", async () => {
    const { dept, owner } = await setupDraft();
    await upsertBudgetYearHeadcount(toCurrentUser(owner), dept.id, 2027, 13);
    await upsertBudgetYearHeadcount(toCurrentUser(owner), dept.id, 2027, 20);

    const rows = await prisma.departmentHeadcount.findMany({ where: { departmentId: dept.id, fiscalYear: 2027 } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.headcount).toBe(20);
  });

  it("rejects a user without department access", async () => {
    const { dept } = await setupDraft();
    const otherOwner = await createUser({ role: "BUDGET_OWNER" });

    await expect(upsertBudgetYearHeadcount(toCurrentUser(otherOwner), dept.id, 2027, 5)).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects a role without budget.edit_own_department (e.g. SYSTEM_ADMIN)", async () => {
    const { dept } = await setupDraft();
    const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });

    await expect(upsertBudgetYearHeadcount(toCurrentUser(admin), dept.id, 2027, 5)).rejects.toBeInstanceOf(ApiError);
  });

  it("writes an audit log entry recording the before/after headcount", async () => {
    const { dept, owner } = await setupDraft();
    await upsertBudgetYearHeadcount(toCurrentUser(owner), dept.id, 2027, 13);

    const logs = await prisma.auditLog.findMany({ where: { action: "DEPARTMENT_HEADCOUNT_UPDATED" } });
    expect(logs).toHaveLength(1);
    expect(logs[0]!.actorUserId).toBe(owner.id);
  });
});
