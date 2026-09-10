import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { createUser, toCurrentUser } from "./helpers/factory";
import { prisma } from "@/lib/prisma";
import { initializeBudgetOwnerDepartments } from "@/lib/masterdata/initializeBudgetOwnerDepartments";
import { startStage2bPreparation } from "@/lib/budget/stage2bDraftService";
import { BUDGET_OWNER_ROSTER } from "@/lib/masterdata/budgetOwnerRoster";
import { STAGE2A_ACCOUNTS } from "@/lib/testdata/stage2aAccounts";

/**
 * Reproduces the exact real-world condition that caused the "1/124" bug
 * reported against 董事長室 (10003): the canonical, all-four-class chart
 * (STAGE2A_ACCOUNTS - sourceSeq always null, 62/62/62/52) coexisting with a
 * SEPARATE, unrelated 62-item M-class-only chart carrying sourceSeq (the
 * demo-only chart seedDemoMasterData.ts imports for 17203's manual
 * walkthrough, from a different source file entirely - see
 * lib/budget/lineService.ts's forceEditable doc comment). A plain
 * majorCategory filter would double M's count to 124; forceEditable must
 * additionally filter on sourceSeq IS NULL.
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
    })),
  });
  // The separate, legacy demo-only 62-item M-class chart (sourceSeq
  // populated) - same shape as seedDemoMasterData.ts's DEMO_ACCOUNTS, using
  // throwaway codes/names since only its sourceSeq-tagged-ness matters here.
  await prisma.account.createMany({
    data: Array.from({ length: 62 }, (_, i) => ({
      code: `demo-legacy-${i + 1}`,
      name: `demo科目${i + 1}`,
      majorCategory: "M" as const,
      commonCategory: "OFFICE" as const,
      entryType: "DEPARTMENT_INPUT" as const,
      isActive: true,
      sourceSeq: i + 1,
    })),
  });
}

const EXPECTED_DENOMINATOR: Record<"M" | "S" | "R" | "P", number> = { M: 62, S: 62, R: 62, P: 52 };

beforeEach(async () => {
  await resetDatabase();
});

describe("all 45 departments' applicable-line denominator, against the realistic (legacy-duplicate-laden) account universe", () => {
  it("every department's forceEditable draft gets exactly its class's canonical count - never doubled by the legacy demo M-class chart", async () => {
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

  it("legacy sourceSeq-tagged accounts are excluded only from forceEditable drafts, not from a real department's normal (forceEditable:false) draft", async () => {
    await seedRealisticAccountUniverse();
    // A hypothetical second real M-class department using the NORMAL
    // (non-Stage-2B-2) draft path must still see its full, real account
    // universe - forceEditable's exclusion is scoped, not global.
    const { createBudgetVersionDraft } = await import("@/lib/budget/lineService");
    const dept = await prisma.department.create({ data: { code: "REAL-M-1", name: "假設的另一個真實管理部門", class: "M" } });
    const owner = toCurrentUser(await createUser({ role: "BUDGET_OWNER", companyWide: true }));
    const version = await createBudgetVersionDraft(owner, dept.id, 2099); // forceEditable defaults to false
    const lines = await prisma.budgetLine.findMany({ where: { budgetVersionId: version.id } });
    expect(lines.length).toBe(124); // sees BOTH M-class charts, unfiltered - the pre-existing, unmodified behavior
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
