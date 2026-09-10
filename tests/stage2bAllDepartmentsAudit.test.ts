import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { createUser, toCurrentUser } from "./helpers/factory";
import { prisma } from "@/lib/prisma";
import { initializeBudgetOwnerDepartments } from "@/lib/masterdata/initializeBudgetOwnerDepartments";
import { startStage2bPreparation } from "@/lib/budget/stage2bDraftService";
import { createBudgetVersionDraft } from "@/lib/budget/lineService";
import { BUDGET_OWNER_ROSTER } from "@/lib/masterdata/budgetOwnerRoster";
import { STAGE2A_ACCOUNTS } from "@/lib/testdata/stage2aAccounts";

/**
 * Reproduces the exact real-world condition that caused the "1/124" bug
 * reported against 董事長室 (10003), and its second occurrence against
 * 17203 財務管理處 via the GENERAL (non-Stage-2B-2) draft path: the
 * canonical, all-four-class chart (STAGE2A_ACCOUNTS, AccountCatalog.
 * OFFICIAL, 62/62/62/52) coexisting with a SEPARATE, unrelated 62-item
 * M-class-only chart (AccountCatalog.FINANCE_DEMO - the demo-only chart
 * seedDemoMasterData.ts imports for 17203's own manual walkthrough, from a
 * different source file entirely). See
 * src/lib/budget/accountSelection.ts's doc comment: account selection is
 * now centralized there and always filters on catalog === "OFFICIAL",
 * regardless of forceEditable/isTestData/role/entry point - a first fix
 * attempt that instead gated a sourceSeq filter on forceEditable left the
 * default (forceEditable: false) path, used by every REAL department
 * including 17203, still able to select all 124 M-class accounts.
 */
async function seedRealisticAccountUniverse() {
  await prisma.account.createMany({
    data: STAGE2A_ACCOUNTS.map((a) => ({
      code: a.code,
      name: a.name,
      majorCategory: a.majorCategory,
      commonCategory: a.commonCategory,
      entryType: a.entryType,
      formulaKey: a.formulaKey,
      isActive: true,
      sourceSeq: null,
      catalog: "OFFICIAL" as const,
    })),
  });
  // The separate, legacy FINANCE_DEMO-only 62-item M-class chart - same
  // shape as seedDemoMasterData.ts's DEMO_ACCOUNTS, using throwaway codes/
  // names since only its catalog tag matters here.
  await prisma.account.createMany({
    data: Array.from({ length: 62 }, (_, i) => ({
      code: `demo-legacy-${i + 1}`,
      name: `demo科目${i + 1}`,
      majorCategory: "M" as const,
      commonCategory: "OFFICE" as const,
      entryType: "DEPARTMENT_INPUT" as const,
      isActive: true,
      sourceSeq: i + 1,
      catalog: "FINANCE_DEMO" as const,
    })),
  });
}

const EXPECTED_DENOMINATOR: Record<"M" | "S" | "R" | "P", number> = { M: 62, S: 62, R: 62, P: 52 };

beforeEach(async () => {
  await resetDatabase();
});

describe("all 45 departments' applicable-line denominator, against the realistic (legacy-duplicate-laden) account universe", () => {
  it("every department's Stage 2B-2 (forceEditable) draft gets exactly its class's canonical count - never doubled by the legacy demo M-class chart", async () => {
    await seedRealisticAccountUniverse();
    const admin = toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
    await initializeBudgetOwnerDepartments(admin);
    const owner = toCurrentUser(await createUser({ role: "BUDGET_OWNER", companyWide: true }));

    const auditRows: {
      code: string;
      class: string;
      lineCount: number;
      distinctAccountCount: number;
      expected: number;
      confirmedLineCount: number;
      pass: boolean;
    }[] = [];

    for (const entry of BUDGET_OWNER_ROSTER) {
      const dept = await prisma.department.findUniqueOrThrow({ where: { code: entry.code } });
      const version = await startStage2bPreparation(owner, dept.id);
      const lines = await prisma.budgetLine.findMany({ where: { budgetVersionId: version.id } });
      const distinctAccountCount = new Set(lines.map((l) => l.accountId)).size;
      const expected = EXPECTED_DENOMINATOR[entry.class as "M" | "S" | "R" | "P"];
      auditRows.push({
        code: entry.code,
        class: entry.class,
        lineCount: lines.length,
        distinctAccountCount,
        expected,
        confirmedLineCount: lines.filter((l) => l.inputConfirmedAt !== null).length,
        pass: lines.length === expected && distinctAccountCount === expected,
      });
    }

    const failures = auditRows.filter((r) => !r.pass);
    if (failures.length > 0) {
      // eslint-disable-next-line no-console
      console.error("Denominator audit failures:", JSON.stringify(failures, null, 2));
    }
    expect(failures).toEqual([]);
    expect(auditRows.length).toBe(45);

    // Every fresh line starts unconfirmed - none of the 45 drafts fabricate
    // a confirmed state.
    expect(auditRows.every((r) => r.confirmedLineCount === 0)).toBe(true);

    // Per-class breakdown matches the required denominators exactly.
    const byClass = { M: 0, S: 0, R: 0, P: 0 };
    for (const r of auditRows) byClass[r.class as "M" | "S" | "R" | "P"]++;
    expect(byClass).toEqual({ M: 7, S: 24, R: 9, P: 5 });
    for (const r of auditRows) {
      expect(r.lineCount).toBe(EXPECTED_DENOMINATOR[r.class as "M" | "S" | "R" | "P"]);
    }
  });

  it("17203 財務管理處 via the GENERAL (forceEditable:false) path also gets exactly 62 official accounts, never 124", async () => {
    await seedRealisticAccountUniverse();
    const dept = await prisma.department.create({ data: { code: "17203", name: "財務管理處", class: "M" } });
    const owner = toCurrentUser(await createUser({ role: "BUDGET_OWNER", companyWide: true }));

    // forceEditable defaults to false - the exact path every real
    // department (17203 included) uses today.
    const version = await createBudgetVersionDraft(owner, dept.id, 2027);
    const lines = await prisma.budgetLine.findMany({ where: { budgetVersionId: version.id }, include: { account: true } });
    expect(lines.length).toBe(62);
    expect(new Set(lines.map((l) => l.accountId)).size).toBe(62);
    expect(lines.every((l) => l.account.catalog === "OFFICIAL")).toBe(true);
  });

  it("forceEditable true vs false select the identical account set for the same department/class - the flag only changes editability", async () => {
    await seedRealisticAccountUniverse();
    const deptA = await prisma.department.create({ data: { code: "TESTM-A", name: "測試管理部門A", class: "M" } });
    const deptB = await prisma.department.create({ data: { code: "TESTM-B", name: "測試管理部門B", class: "M" } });
    const owner = toCurrentUser(await createUser({ role: "BUDGET_OWNER", companyWide: true }));

    const versionForceTrue = await createBudgetVersionDraft(owner, deptA.id, 2027, { forceEditable: true });
    const versionForceFalse = await createBudgetVersionDraft(owner, deptB.id, 2027, { forceEditable: false });

    const linesTrue = await prisma.budgetLine.findMany({ where: { budgetVersionId: versionForceTrue.id } });
    const linesFalse = await prisma.budgetLine.findMany({ where: { budgetVersionId: versionForceFalse.id } });

    expect(linesTrue.length).toBe(62);
    expect(linesFalse.length).toBe(62);
    expect(new Set(linesTrue.map((l) => l.accountId))).toEqual(new Set(linesFalse.map((l) => l.accountId)));

    // forceEditable still controls editability, just never account selection.
    expect(linesTrue.every((l) => !l.isLocked)).toBe(true);
    const account = await prisma.account.findFirst({ where: { catalog: "OFFICIAL", entryType: "NOT_BUDGETED" } });
    if (account) {
      const forcedLine = linesTrue.find((l) => l.accountId === account.id);
      const normalLine = linesFalse.find((l) => l.accountId === account.id);
      expect(forcedLine?.isLocked).toBe(false);
      expect(normalLine?.isLocked).toBe(true);
    }
  });

  it("requestAdjustment copies the parent version's own accountIds verbatim - it never re-selects from Account and so can never mix in a second catalog", async () => {
    await seedRealisticAccountUniverse();
    const { requestAdjustment, submitBudgetVersion, startReview, approveBudgetVersion } = await import("@/lib/workflow/actions");
    const { grantDepartmentScope } = await import("./helpers/factory");

    const dept = await prisma.department.create({ data: { code: "ADJ-M-1", name: "測試調整部門", class: "M" } });
    const ownerRow = await createUser({ role: "BUDGET_OWNER" });
    await grantDepartmentScope(ownerRow.id, dept.id);
    const owner = toCurrentUser(ownerRow);
    const reviewer = toCurrentUser(await createUser({ role: "FINANCE_REVIEWER", companyWide: true }));
    const approver = toCurrentUser(await createUser({ role: "FINANCE_APPROVER", companyWide: true }));

    const draft = await createBudgetVersionDraft(owner, dept.id, 2027, { forceEditable: true });
    const parentLines = await prisma.budgetLine.findMany({ where: { budgetVersionId: draft.id } });
    expect(parentLines.length).toBe(62);
    const parentAccountIds = new Set(parentLines.map((l) => l.accountId));

    await submitBudgetVersion(owner, draft.id);
    await startReview(reviewer, draft.id);
    await approveBudgetVersion(approver, draft.id);

    const adjustment = await requestAdjustment(owner, draft.id, "測試調整");
    const adjLines = await prisma.budgetLine.findMany({ where: { budgetVersionId: adjustment.id } });

    expect(adjLines.length).toBe(62);
    expect(new Set(adjLines.map((l) => l.accountId))).toEqual(parentAccountIds);
  });

  it("aggregation (KNOWN_DEPARTMENT_CODES) has no duplicate codes and matches the roster exactly, so no department is summed twice", async () => {
    const { KNOWN_DEPARTMENT_CODES } = await import("@/lib/reports/budgetSummaryPreviewData");
    expect(KNOWN_DEPARTMENT_CODES.length).toBe(45);
    expect(new Set(KNOWN_DEPARTMENT_CODES).size).toBe(45);
    const rosterCodes = new Set(BUDGET_OWNER_ROSTER.map((r) => r.code));
    for (const code of KNOWN_DEPARTMENT_CODES) {
      expect(rosterCodes.has(code)).toBe(true);
    }
  });
});
