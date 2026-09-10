import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "@/lib/auth/session";
import { ApiError } from "@/lib/rbac/guard";
import { createBudgetVersionDraft } from "./lineService";
import { BUDGET_OWNER_ROSTER } from "@/lib/masterdata/budgetOwnerRoster";

export const STAGE2B_BUDGET_FISCAL_YEAR = 2027;

const ROSTER_CODES = new Set(BUDGET_OWNER_ROSTER.map((r) => r.code));

/**
 * "開始編製" - lazily creates this department's 2027 draft on demand, the
 * ONLY way a Stage 2B-2 BudgetVersion ever comes into existence (see
 * Stage 2B-2 §二.7: no batch pre-creation of all 45 drafts up front, which
 * would make every not-yet-started department look "已開始" the instant
 * the roster is initialized). Restricted to the 45-department roster so
 * this endpoint cannot be pointed at an arbitrary departmentId to bypass
 * the normal (forceEditable: false) createBudgetVersionDraft path used
 * elsewhere in the app.
 *
 * Delegates entirely to createBudgetVersionDraft with forceEditable: true
 * (see that function's own doc comment) - same capability/department-
 * access checks, same idempotent 409-on-existing-draft guard, same
 * P2028-avoidance single-batch-transaction write.
 */
export async function startStage2bPreparation(user: CurrentUser, departmentId: string) {
  const department = await prisma.department.findUnique({ where: { id: departmentId }, select: { code: true } });
  if (!department) throw new ApiError(404, "找不到此部門");
  if (!ROSTER_CODES.has(department.code)) {
    throw new ApiError(422, "此部門不在 Stage 2B-2 的 45 個預算編製單位名冊中");
  }
  return createBudgetVersionDraft(user, departmentId, STAGE2B_BUDGET_FISCAL_YEAR, { forceEditable: true });
}
