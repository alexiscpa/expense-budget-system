import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { createDepartment, createUser, toCurrentUser } from "./helpers/factory";
import { prisma } from "@/lib/prisma";
import { initializeBudgetOwnerDepartments } from "@/lib/masterdata/initializeBudgetOwnerDepartments";
import { BUDGET_OWNER_ROSTER, getRosterCategoryCounts } from "@/lib/masterdata/budgetOwnerRoster";
import { ApiError } from "@/lib/rbac/guard";

const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;

function setVercelEnv(value: string | undefined) {
  if (value === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = value;
}

afterEach(() => {
  setVercelEnv(ORIGINAL_VERCEL_ENV);
});

beforeEach(async () => {
  await resetDatabase();
});

describe("BUDGET_OWNER_ROSTER", () => {
  it("has exactly 45 entries with no duplicate codes", () => {
    expect(BUDGET_OWNER_ROSTER.length).toBe(45);
    const codes = new Set(BUDGET_OWNER_ROSTER.map((r) => r.code));
    expect(codes.size).toBe(45);
  });

  it("matches the manifest's M/S/R/P category counts (7/24/9/5)", () => {
    const counts = getRosterCategoryCounts();
    expect(counts.M).toBe(7);
    expect(counts.S).toBe(24);
    expect(counts.R).toBe(9);
    expect(counts.P).toBe(5);
  });

  it("does not include 12501 (confirmed deactivated per Stage 2B-1 v1.3)", () => {
    expect(BUDGET_OWNER_ROSTER.some((r) => r.code === "12501")).toBe(false);
  });
});

describe("initializeBudgetOwnerDepartments", () => {
  it("creates all 45 departments on a fresh database, none with fabricated 2026 data", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    const result = await initializeBudgetOwnerDepartments(admin);

    expect(result.addedCodes.length).toBe(45);
    expect(result.existingCodes.length).toBe(0);
    expect(result.conflicts.length).toBe(0);

    const rows = await prisma.department.findMany();
    expect(rows.length).toBe(45);
    for (const row of rows) {
      expect(row.priorYearHeadcount).toBeNull();
      expect(row.priorYearReferenceFiscalYear).toBeNull();
      expect(row.isBudgetOwner).toBe(true);
      expect(row.isTestData).toBe(false);
    }
  });

  it("is idempotent: re-running after full creation adds nothing new", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    const second = await initializeBudgetOwnerDepartments(admin);

    expect(second.addedCodes.length).toBe(0);
    expect(second.existingCodes.length).toBe(45);
    const rows = await prisma.department.findMany();
    expect(rows.length).toBe(45);
  });

  it("never overwrites or duplicates the 9 pre-existing departments' data", async () => {
    const existing = await createDepartment({
      code: "17203",
      name: "財務管理處",
      class: "M",
      priorYearHeadcount: 10,
      priorYearReferenceFiscalYear: 2025,
    });
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));

    const result = await initializeBudgetOwnerDepartments(admin);

    expect(result.existingCodes).toContain("17203");
    expect(result.addedCodes).not.toContain("17203");

    const rows = await prisma.department.findMany({ where: { code: "17203" } });
    expect(rows.length).toBe(1);
    const row = rows[0]!;
    expect(row.id).toBe(existing.id);
    expect(row.priorYearHeadcount).toBe(10);
    expect(row.priorYearReferenceFiscalYear).toBe(2025);
  });

  it("aborts the whole batch and creates nothing when an existing row's class conflicts with the roster", async () => {
    await createDepartment({ code: "10003", name: "董事長室", class: "S" }); // roster expects M
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));

    await expect(initializeBudgetOwnerDepartments(admin)).rejects.toThrow(ApiError);

    const rows = await prisma.department.findMany();
    // Only the pre-seeded conflicting row should exist - nothing else was
    // created despite 44 other codes having no conflict.
    expect(rows.length).toBe(1);
  });

  it("reports (not reactivates) an existing roster code that is currently inactive", async () => {
    await createDepartment({ code: "11022", name: "工設機構部", class: "R" });
    await prisma.department.update({ where: { code: "11022" }, data: { isActive: false } });
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));

    const result = await initializeBudgetOwnerDepartments(admin);

    expect(result.skippedCodes.map((s) => s.code)).toContain("11022");
    expect(result.addedCodes).not.toContain("11022");
    const row = await prisma.department.findUnique({ where: { code: "11022" } });
    expect(row?.isActive).toBe(false);
  });

  it("refuses to run when VERCEL_ENV is production", async () => {
    setVercelEnv("production");
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await expect(initializeBudgetOwnerDepartments(admin)).rejects.toThrow(ApiError);
    const rows = await prisma.department.findMany();
    expect(rows.length).toBe(0);
  });
});
