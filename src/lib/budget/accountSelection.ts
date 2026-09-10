import type { Account, DeptClass } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * The single, centralized account-selection function every entry point
 * that creates a fresh set of BudgetLine rows for a department must call.
 * Always returns only AccountCatalog.OFFICIAL rows for the department's
 * class - the canonical, all-four-class M/S/R/P chart (62/62/62/52)
 * sourced from 2025費用總表, never the separate FINANCE_DEMO chart
 * (17203's own one-off 62-item manual-demo accounts - see
 * prisma/schema.prisma's AccountCatalog doc comment).
 *
 * This is completely independent of forceEditable, isTestData, the
 * caller's role, or which API route/service function is calling it -
 * there is exactly one rule for "which accounts apply to a NEW draft for
 * this department's class", and it lives here. forceEditable (see
 * CreateBudgetVersionDraftOptions in lineService.ts) only ever controls
 * whether the resulting BudgetLine rows start locked or editable - it must
 * never also change which accounts are selected in the first place.
 *
 * Never touches or re-selects accounts for an EXISTING BudgetVersion's
 * lines - requestAdjustment (lib/workflow/actions.ts) copies a parent
 * version's own lines verbatim (same accountId), and this function is
 * never called in that path, so a department's historical BudgetLine rows
 * (whichever catalog they happen to reference) are never disturbed.
 */
export async function getBudgetAccountsForDepartment(params: {
  department: { class: DeptClass };
}): Promise<Account[]> {
  return prisma.account.findMany({
    where: { isActive: true, majorCategory: params.department.class, catalog: "OFFICIAL" },
  });
}
