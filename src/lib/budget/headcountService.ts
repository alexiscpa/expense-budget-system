import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "@/lib/auth/session";
import { requireCapability, requireDepartmentAccess, ApiError } from "@/lib/rbac/guard";
import { isEditable } from "@/lib/workflow/stateMachine";
import { writeAuditLog } from "@/lib/audit/log";

/**
 * Sanity upper bound for a department's 2026 budget headcount - large enough
 * for any real department, small enough to reject an obviously wrong input
 * (an extra digit, a pasted amount) rather than silently accepting it.
 */
export const MAX_DEPARTMENT_HEADCOUNT = 100000;

/**
 * `budgetYearHeadcount` arrives as a string (same convention as the money
 * fields in updateDepartmentInputLine) so validation is exact and never
 * subject to JS number coercion quirks. Only a plain non-negative integer -
 * no decimal point, no leading/trailing sign, no thousands-separator comma,
 * no other text - of at most 6 digits (covering the full 0..100000 range)
 * passes; anything else, including an empty string, is rejected.
 */
const HEADCOUNT_INPUT_PATTERN = /^\d{1,6}$/;

export function parseHeadcountInput(raw: string): number {
  if (!HEADCOUNT_INPUT_PATTERN.test(raw)) {
    throw new ApiError(422, "部門人數格式錯誤：只接受 0 以上的整數，不可包含小數點、負號、逗號或其他文字");
  }
  const value = Number(raw);
  if (value > MAX_DEPARTMENT_HEADCOUNT) {
    throw new ApiError(422, `部門人數不可超過 ${MAX_DEPARTMENT_HEADCOUNT} 人`);
  }
  return value;
}

/**
 * Updates only BudgetVersion.budgetYearHeadcount (the 2026 department
 * headcount figure) - never priorYearHeadcount (the 2025 reference, which
 * has no user-facing write path anywhere in the app) and never anything
 * that would make this a general-purpose BudgetVersion editor. 部門人數 is
 * not an accounting line item: it has no Account/BudgetLine, and updating
 * it here never touches any BudgetLine amount or category subtotal.
 *
 * Same permission/workflow-gating shape as updateDepartmentInputLine
 * (lib/budget/lineService.ts): requires budget.edit_own_department,
 * re-validates department access against the version's actual
 * departmentId (never trusting a client-supplied department), and is only
 * writable while the version is in an editable status - once SUBMITTED (or
 * any other non-editable status), this throws exactly like a locked budget
 * line would, so the department preparer can only view, never modify, the
 * headcount on a submitted version.
 */
export async function updateBudgetYearHeadcount(user: CurrentUser, versionId: string, budgetYearHeadcountInput: string) {
  await requireCapability(user, "budget.edit_own_department");

  return prisma.$transaction(async (tx) => {
    const version = await tx.budgetVersion.findUnique({ where: { id: versionId } });
    if (!version) throw new ApiError(404, "找不到此預算版本");
    await requireDepartmentAccess(user, version.departmentId);

    if (!isEditable(version.status)) {
      throw new ApiError(409, "送出後填報人不得直接修改，必須由財務退回後才能修改");
    }

    const budgetYearHeadcount = parseHeadcountInput(budgetYearHeadcountInput);
    // 最後一次編製日期 only moves when the value actually changes - saving
    // the same headcount again (e.g. clicking into and back out of the
    // field) must not bump it.
    const hasChanged = budgetYearHeadcount !== version.budgetYearHeadcount;

    const updated = await tx.budgetVersion.update({
      where: { id: versionId },
      data: hasChanged ? { budgetYearHeadcount, lastPreparedAt: new Date() } : { budgetYearHeadcount },
    });

    await writeAuditLog(
      {
        actorUserId: user.id,
        action: "BUDGET_HEADCOUNT_UPDATED",
        entityType: "BudgetVersion",
        entityId: versionId,
        beforeData: { budgetYearHeadcount: version.budgetYearHeadcount },
        afterData: { budgetYearHeadcount: updated.budgetYearHeadcount },
      },
      tx as Prisma.TransactionClient
    );

    return updated;
  });
}
