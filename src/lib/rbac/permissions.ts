import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "@/lib/auth/session";

/**
 * Capability matrix. Every permission check in the app routes through this
 * module (never through client-supplied flags) so the frontend cannot widen
 * its own access. See docs/requirements-traceability.md §五 for the source
 * requirement.
 */
export const ROLE_CAPABILITIES: Record<Role, string[]> = {
  SYSTEM_ADMIN: [
    "user.manage",
    "master_data.import",
    "master_data.view",
    "formula.manage",
    "budget.view_any",
    "audit.view",
    "dual_control.approve",
  ],
  BUDGET_OWNER: [
    "budget.edit_own_department",
    "budget.submit_own_department",
    "budget.view_own_department",
    "budget.adjustment.request",
  ],
  DEPARTMENT_EDITOR: ["budget.edit_own_department", "budget.view_own_department"],
  DEPARTMENT_REVIEWER: ["budget.view_own_department", "budget.department_review"],
  FINANCE_REVIEWER: ["budget.view_any", "budget.finance_review", "budget.return", "report.view"],
  FINANCE_APPROVER: [
    "budget.view_any",
    "budget.approve",
    "budget.lock",
    "budget.adjustment.approve",
    "report.view",
    "report.export_official",
    "dual_control.approve",
  ],
  READ_ONLY: ["budget.view_scoped", "report.view"],
  AUDITOR: ["audit.view", "budget.view_any_readonly"],
};

export function hasCapability(role: Role, capability: string): boolean {
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}

/**
 * Returns the set of department ids a user is permitted to see budget data
 * for. Company-wide roles get null, meaning "all departments" - callers must
 * treat null and [] very differently (null = unrestricted, [] = none).
 */
export async function getAccessibleDepartmentIds(user: CurrentUser): Promise<string[] | null> {
  if (user.companyWide) return null;
  const scopes = await prisma.userDepartmentScope.findMany({
    where: { userId: user.id },
    select: { departmentId: true },
  });
  return scopes.map((s) => s.departmentId);
}

export async function canAccessDepartment(user: CurrentUser, departmentId: string): Promise<boolean> {
  const accessible = await getAccessibleDepartmentIds(user);
  if (accessible === null) return true;
  return accessible.includes(departmentId);
}

/** Only finance/admin roles may see raw payroll figures behind FORMULA accounts. */
export function canViewSalaryDetail(role: Role): boolean {
  return role === "SYSTEM_ADMIN" || role === "FINANCE_REVIEWER" || role === "FINANCE_APPROVER";
}
