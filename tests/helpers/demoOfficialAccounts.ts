import { prisma } from "@/lib/prisma";
import {
  DEMO_DEPARTMENT_CODE,
  DEMO_DEPARTMENT_NAME,
  DEMO_DEPARTMENT_CLASS,
  DEMO_DEPARTMENT_PRIOR_YEAR_HEADCOUNT,
  DEMO_PRIOR_REFERENCE_FISCAL_YEAR,
  DEMO_ACCOUNTS,
} from "@/lib/demo/constants";

/**
 * Test-only stand-in for "17203 財務管理處 already has its real OFFICIAL
 * M-class chart of accounts provisioned" - exactly the state a real
 * environment is always in by the time anyone opens the "Demo 測試環境"
 * walkthrough screen, because Stage 2B-2 initialization (which seeds the
 * canonical 62/62/62/52 OFFICIAL chart for all 45 BUDGET_OWNER departments,
 * 17203 included - see src/lib/budget/accountSelection.ts) always runs
 * first.
 *
 * createBudgetVersionDraft now always selects catalog:"OFFICIAL" accounts
 * for a department's class, with no exception for forceEditable, role, or
 * fiscal year (see accountSelection.ts's doc comment) - so the demo
 * walkthrough's own draft creation relies on that real OFFICIAL chart, never
 * on seedDemoMasterData's own catalog:"FINANCE_DEMO" import (which is
 * deliberately excluded from selection - see seedDemoMasterData.ts).
 *
 * This reuses DEMO_ACCOUNTS' own codes/categories/reference amounts as the
 * OFFICIAL fixture data purely so every pre-existing figure/code assertion
 * in the demo-walkthrough tests (e.g. code "3" 薪資支出 = 7905511) keeps
 * meaning exactly what it did before the catalog split - it is fixture data
 * standing in for "the real OFFICIAL chart", not a claim that Stage 2B-2's
 * actual chart shares these figures.
 */
export async function seedOfficialAccountsFor17203() {
  const department = await prisma.department.upsert({
    where: { code: DEMO_DEPARTMENT_CODE },
    update: {
      name: DEMO_DEPARTMENT_NAME,
      class: DEMO_DEPARTMENT_CLASS,
      isActive: true,
      priorYearHeadcount: DEMO_DEPARTMENT_PRIOR_YEAR_HEADCOUNT,
      priorYearReferenceFiscalYear: DEMO_PRIOR_REFERENCE_FISCAL_YEAR,
    },
    create: {
      code: DEMO_DEPARTMENT_CODE,
      name: DEMO_DEPARTMENT_NAME,
      class: DEMO_DEPARTMENT_CLASS,
      priorYearHeadcount: DEMO_DEPARTMENT_PRIOR_YEAR_HEADCOUNT,
      priorYearReferenceFiscalYear: DEMO_PRIOR_REFERENCE_FISCAL_YEAR,
    },
  });

  await prisma.account.createMany({
    data: DEMO_ACCOUNTS.map((item) => ({
      code: String(item.seq),
      name: item.name,
      majorCategory: DEMO_DEPARTMENT_CLASS,
      commonCategory: item.commonCategory,
      entryType: "DEPARTMENT_INPUT" as const,
      isActive: true,
      priorYearReferenceAmount: item.priorYearReferenceAmount,
      priorYearReferenceFiscalYear: DEMO_PRIOR_REFERENCE_FISCAL_YEAR,
      catalog: "OFFICIAL" as const,
    })),
  });

  return department;
}
