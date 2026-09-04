import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { createDepartment, createUser, createAccount, grantDepartmentScope, toCurrentUser } from "./helpers/factory";
import { evaluateFormula } from "@/lib/formula/engine";
import { createBudgetVersionDraft } from "@/lib/budget/lineService";
import { prisma } from "@/lib/prisma";

beforeEach(async () => {
  await resetDatabase();
});

describe("FORMULA engine - never silently defaults to 0", () => {
  it("returns NOT_CONFIGURED (not 0) when no FormulaDefinition exists for the key", async () => {
    const dept = await createDepartment();
    const result = await evaluateFormula("MISSING_KEY", dept.id, 2027, new Map());
    expect(result.status).toBe("NOT_CONFIGURED");
    expect(result.amount).toBeNull();
  });

  it("returns NOT_CONFIGURED when salary data source is missing, even if a formula is defined", async () => {
    const dept = await createDepartment();
    const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    await prisma.formulaDefinition.create({
      data: {
        key: "PER_EMPLOYEE_MEAL",
        version: 1,
        description: "伙食費 = 每人3000元 x 12月",
        expression: { kind: "per_employee_flat", amountPerEmployee: 3000, months: 12 },
        effectiveFrom: new Date("2020-01-01"),
        createdById: admin.id,
      },
    });

    const result = await evaluateFormula("PER_EMPLOYEE_MEAL", dept.id, 2027, new Map());
    expect(result.status).toBe("NOT_CONFIGURED");
    expect(result.reason).toContain("薪資資料來源尚未設定");
  });

  it("computes a real amount once both formula and confirmed salary data exist", async () => {
    const dept = await createDepartment();
    const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    await prisma.formulaDefinition.create({
      data: {
        key: "PER_EMPLOYEE_MEAL",
        version: 1,
        description: "伙食費 = 每人3000元 x 12月",
        expression: { kind: "per_employee_flat", amountPerEmployee: 3000, months: 12 },
        effectiveFrom: new Date("2020-01-01"),
        createdById: admin.id,
      },
    });
    await prisma.salaryDataSource.create({
      data: {
        departmentId: dept.id,
        fiscalYear: 2026,
        month: 10,
        totalBaseSalary: "1000000",
        employeeCount: 5,
        isConfirmed: true,
        source: "test-fixture",
      },
    });

    const result = await evaluateFormula("PER_EMPLOYEE_MEAL", dept.id, 2027, new Map());
    expect(result.status).toBe("CONFIGURED");
    expect(result.amount?.toString()).toBe("180000");
  });

  it("draft creation locks FORMULA lines and flags NOT_CONFIGURED accounts distinctly from real zero amounts", async () => {
    const dept = await createDepartment();
    const owner = await createUser({ role: "BUDGET_OWNER", companyWide: false });
    await grantDepartmentScope(owner.id, dept.id);
    await createAccount({ entryType: "FORMULA", formulaKey: "NO_SUCH_FORMULA", majorCategory: dept.class });
    await createAccount({ entryType: "NOT_BUDGETED", majorCategory: dept.class });

    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2027);
    const lines = await prisma.budgetLine.findMany({ where: { budgetVersionId: draft.id } });

    const formulaLine = lines.find((l) => l.entryTypeSnapshot === "FORMULA");
    const notBudgetedLine = lines.find((l) => l.entryTypeSnapshot === "NOT_BUDGETED");

    expect(formulaLine?.formulaStatus).toBe("NOT_CONFIGURED");
    expect(formulaLine?.isLocked).toBe(true);
    expect(notBudgetedLine?.formulaStatus).toBe("NOT_APPLICABLE");
    expect(notBudgetedLine?.nextYearTotal.toString()).toBe("0");
    expect(notBudgetedLine?.isLocked).toBe(true);
  });
});
