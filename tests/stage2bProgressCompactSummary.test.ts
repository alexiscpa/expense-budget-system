import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { resetDatabase } from "./helpers/reset";
import { createAccount, createUser, toCurrentUser } from "./helpers/factory";
import { prisma } from "@/lib/prisma";
import { initializeBudgetOwnerDepartments } from "@/lib/masterdata/initializeBudgetOwnerDepartments";
import { startStage2bPreparation } from "@/lib/budget/stage2bDraftService";
import { updateDepartmentInputLine, completePreparation } from "@/lib/budget/lineService";
import { updateBudgetYearHeadcount } from "@/lib/budget/headcountService";
import { submitBudgetVersion, startReview, returnBudgetVersion, approveBudgetVersion } from "@/lib/workflow/actions";
import { loadStage2bProgress } from "@/lib/reports/stage2bProgress";
import { BUDGET_OWNER_ROSTER, BUDGET_OWNER_ROSTER_SIZE } from "@/lib/masterdata/budgetOwnerRoster";

const APP_DIR = join(__dirname, "..", "src", "app", "dashboard");

/**
 * Drives a real 45-roster department's real BudgetVersion through the
 * given target status via the actual workflow actions (never fabricated by
 * writing BudgetStatus directly), mirroring the transitions already proven
 * in tests/stage2bProgress.test.ts.
 */
async function driveDepartmentToStatus(
  code: string,
  target: "READY_TO_SUBMIT" | "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "RETURNED" | "IN_PROGRESS" | "DRAFT_EMPTY"
) {
  const dept = await prisma.department.findUniqueOrThrow({ where: { code } });
  const owner = toCurrentUser(await createUser({ role: "BUDGET_OWNER", companyWide: true }));
  const version = await startStage2bPreparation(owner, dept.id);
  if (target === "DRAFT_EMPTY") return version;

  const lines = await prisma.budgetLine.findMany({ where: { budgetVersionId: version.id } });
  await updateDepartmentInputLine(owner, version.id, lines[0]!.id, {
    nextYearTargetExcludingNew: "0",
    nextYearNewHireBudget: "0",
  });
  if (target === "IN_PROGRESS") return version;

  await updateBudgetYearHeadcount(owner, version.id, "1");
  await completePreparation(owner, version.id);
  if (target === "READY_TO_SUBMIT") return version;

  await submitBudgetVersion(owner, version.id);
  if (target === "SUBMITTED") return version;

  const reviewer = toCurrentUser(await createUser({ role: "FINANCE_REVIEWER", companyWide: true }));
  await startReview(reviewer, version.id);
  if (target === "UNDER_REVIEW") return version;

  if (target === "RETURNED") {
    await returnBudgetVersion(reviewer, version.id, "需修正");
    return version;
  }

  const approver = toCurrentUser(await createUser({ role: "FINANCE_APPROVER", companyWide: true }));
  await approveBudgetVersion(approver, version.id);
  return version;
}

beforeEach(async () => {
  await resetDatabase();
});

describe("Dashboard 精簡進度摘要 - completedDepartmentCount/completionRate 計算", () => {
  it("1-2. 應編45、完成7時顯示15.6%，未完成顯示38", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    await createAccount({ code: "M1", majorCategory: "M", entryType: "DEPARTMENT_INPUT" });

    // Exactly the 7 M-class departments in the 45-roster, covering all four
    // "completed" statuses (2 READY_TO_SUBMIT + 2 SUBMITTED + 2 UNDER_REVIEW
    // + 1 APPROVED = 7); every other of the 45 roster departments is left
    // untouched (NOT_STARTED by default), giving exactly 38 incomplete.
    const mClassCodes = BUDGET_OWNER_ROSTER.filter((r) => r.class === "M").map((r) => r.code);
    expect(mClassCodes.length).toBe(7);

    await driveDepartmentToStatus(mClassCodes[0]!, "READY_TO_SUBMIT");
    await driveDepartmentToStatus(mClassCodes[1]!, "READY_TO_SUBMIT");
    await driveDepartmentToStatus(mClassCodes[2]!, "SUBMITTED");
    await driveDepartmentToStatus(mClassCodes[3]!, "SUBMITTED");
    await driveDepartmentToStatus(mClassCodes[4]!, "UNDER_REVIEW");
    await driveDepartmentToStatus(mClassCodes[5]!, "UNDER_REVIEW");
    await driveDepartmentToStatus(mClassCodes[6]!, "APPROVED");

    const { summary } = await loadStage2bProgress();
    expect(summary.totalDepartments).toBe(45);
    expect(summary.completedPreparationCount).toBe(7);
    expect(summary.completedPreparationPercent).toBe(15.6);
    expect(summary.totalDepartments - summary.completedPreparationCount).toBe(38);
  });

  it("3. READY_TO_SUBMIT 計入完成", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    await createAccount({ code: "M1", majorCategory: "M", entryType: "DEPARTMENT_INPUT" });
    await driveDepartmentToStatus(BUDGET_OWNER_ROSTER.find((r) => r.class === "M")!.code, "READY_TO_SUBMIT");
    const { summary } = await loadStage2bProgress();
    expect(summary.completedPreparationCount).toBe(1);
  });

  it("4. SUBMITTED 計入完成", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    await createAccount({ code: "M1", majorCategory: "M", entryType: "DEPARTMENT_INPUT" });
    await driveDepartmentToStatus(BUDGET_OWNER_ROSTER.find((r) => r.class === "M")!.code, "SUBMITTED");
    const { summary } = await loadStage2bProgress();
    expect(summary.completedPreparationCount).toBe(1);
  });

  it("5. UNDER_REVIEW 計入完成", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    await createAccount({ code: "M1", majorCategory: "M", entryType: "DEPARTMENT_INPUT" });
    await driveDepartmentToStatus(BUDGET_OWNER_ROSTER.find((r) => r.class === "M")!.code, "UNDER_REVIEW");
    const { summary } = await loadStage2bProgress();
    expect(summary.completedPreparationCount).toBe(1);
  });

  it("6. APPROVED 計入完成", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    await createAccount({ code: "M1", majorCategory: "M", entryType: "DEPARTMENT_INPUT" });
    await driveDepartmentToStatus(BUDGET_OWNER_ROSTER.find((r) => r.class === "M")!.code, "APPROVED");
    const { summary } = await loadStage2bProgress();
    expect(summary.completedPreparationCount).toBe(1);
  });

  it("7. NOT_STARTED 不計入完成", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    const { summary } = await loadStage2bProgress();
    expect(summary.notStarted).toBe(BUDGET_OWNER_ROSTER_SIZE);
    expect(summary.completedPreparationCount).toBe(0);
  });

  it("8. DRAFT_EMPTY 不計入完成", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    await createAccount({ code: "M1", majorCategory: "M", entryType: "DEPARTMENT_INPUT" });
    await driveDepartmentToStatus(BUDGET_OWNER_ROSTER.find((r) => r.class === "M")!.code, "DRAFT_EMPTY");
    const { summary } = await loadStage2bProgress();
    expect(summary.completedPreparationCount).toBe(0);
  });

  it("9. IN_PROGRESS 不計入完成", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    await createAccount({ code: "M1", majorCategory: "M", entryType: "DEPARTMENT_INPUT" });
    await driveDepartmentToStatus(BUDGET_OWNER_ROSTER.find((r) => r.class === "M")!.code, "IN_PROGRESS");
    const { summary } = await loadStage2bProgress();
    expect(summary.completedPreparationCount).toBe(0);
  });

  it("10. RETURNED 不計入完成", async () => {
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    await createAccount({ code: "M1", majorCategory: "M", entryType: "DEPARTMENT_INPUT" });
    await driveDepartmentToStatus(BUDGET_OWNER_ROSTER.find((r) => r.class === "M")!.code, "RETURNED");
    const { summary } = await loadStage2bProgress();
    expect(summary.returned).toBe(1);
    expect(summary.completedPreparationCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Source-level checks for the UI split (no React rendering harness in this
// repo - every existing UI-shaped assertion in this codebase, e.g.
// tests/dashboardNav.test.ts's layout/not-found checks, reads the source
// file directly instead).
// ---------------------------------------------------------------------------

describe("Dashboard home page no longer renders per-department amounts/headcounts or the 45-row table", () => {
  it("11. dashboard/page.tsx does not import or render Stage2bProgressSummaryCards/Stage2bProgressTable, and never mentions per-line amount/headcount labels", () => {
    const source = readFileSync(join(APP_DIR, "page.tsx"), "utf-8");
    expect(source).not.toContain("Stage2bProgressSummaryCards");
    expect(source).not.toContain("Stage2bProgressTable");
    expect(source).not.toContain("2026推估");
    expect(source).not.toContain("2027預算總額");
    expect(source).not.toContain("已確認／應填科目數");
  });

  it("dashboard/page.tsx renders the compact summary only for company-wide viewers (canViewAllDepartments), matching the pre-existing RBAC gate", () => {
    const source = readFileSync(join(APP_DIR, "page.tsx"), "utf-8");
    expect(source).toContain("canViewAllDepartments && (");
    expect(source).toContain("<Stage2bProgressCompactSummary summary={stage2bSummary} />");
  });
});

describe("查看部門明細 entry point and the detail page's return links", () => {
  it("12. Stage2bProgressCompactSummary links to /dashboard/budget-progress", () => {
    const source = readFileSync(join(APP_DIR, "Stage2bProgressCompactSummary.tsx"), "utf-8");
    expect(source).toContain('href="/dashboard/budget-progress"');
    expect(source).toContain("查看部門明細");
  });

  it("13. budget-progress/page.tsx has a 回到預算總覽 link back to /dashboard at both the top and the bottom", () => {
    const source = readFileSync(join(APP_DIR, "budget-progress", "page.tsx"), "utf-8");
    const matches = source.match(/回到預算總覽/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain('href="/dashboard"');
  });

  it("budget-progress/page.tsx still renders the full 45-row table and filters, moved out of the home page", () => {
    const source = readFileSync(join(APP_DIR, "budget-progress", "page.tsx"), "utf-8");
    expect(source).toContain("Stage2bProgressTable");
  });
});

describe("14. 無查看全公司進度權限的使用者不能查看全公司明細", () => {
  it("budget-progress/page.tsx filters rows to the caller's accessible departments exactly like the home page used to, never widening RBAC", () => {
    const source = readFileSync(join(APP_DIR, "budget-progress", "page.tsx"), "utf-8");
    expect(source).toContain("canViewAllDepartments");
    expect(source).toContain("getAccessibleDepartmentIds");
    expect(source).toContain(
      "canViewAllDepartments\n    ? stage2bRows\n    : stage2bRows.filter((r) => r.departmentId !== null && accessibleDepartmentIds?.includes(r.departmentId));"
    );
  });

  it("budget-progress/page.tsx only shows the company-wide summary cards to canViewAllDepartments viewers", () => {
    const source = readFileSync(join(APP_DIR, "budget-progress", "page.tsx"), "utf-8");
    expect(source).toContain("{canViewAllDepartments && <Stage2bProgressSummaryCards summary={stage2bSummary} />}");
  });
});
