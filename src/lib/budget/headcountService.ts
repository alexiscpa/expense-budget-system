import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "@/lib/auth/session";
import { requireCapability, requireDepartmentAccess, ApiError } from "@/lib/rbac/guard";
import { isEditable } from "@/lib/workflow/stateMachine";
import { writeAuditLog } from "@/lib/audit/log";

/**
 * Creates or updates a department's headcount for one fiscal year.
 * departmentId+fiscalYear uniquely identifies the row (DepartmentHeadcount),
 * so writing e.g. 2027 here never touches the 2026 projection row for the
 * same department - each fiscal year's headcount is independent.
 *
 * Only usable for the fiscal year of an editable (DRAFT/RETURNED/
 * ADJUSTMENT_PENDING) BudgetVersion the caller has access to - a prior
 * year's projection (e.g. 2026, written by the test-data seed or a future
 * real import) is never editable through this path.
 */
export async function upsertBudgetYearHeadcount(
  user: CurrentUser,
  departmentId: string,
  fiscalYear: number,
  headcount: number
) {
  await requireCapability(user, "budget.edit_own_department");
  await requireDepartmentAccess(user, departmentId);

  const version = await prisma.budgetVersion.findFirst({
    where: { departmentId, fiscalYear, versionNumber: 1 },
  });
  if (!version) throw new ApiError(404, "找不到此部門此年度的預算版本");
  if (!isEditable(version.status)) {
    throw new ApiError(409, "送出後填報人不得直接修改，必須由財務退回後才能修改");
  }

  const before = await prisma.departmentHeadcount.findUnique({
    where: { departmentId_fiscalYear: { departmentId, fiscalYear } },
  });

  const updated = await prisma.departmentHeadcount.upsert({
    where: { departmentId_fiscalYear: { departmentId, fiscalYear } },
    update: { headcount, sourceType: "USER_INPUT" },
    create: { departmentId, fiscalYear, headcount, sourceType: "USER_INPUT" },
  });

  await writeAuditLog({
    actorUserId: user.id,
    action: "DEPARTMENT_HEADCOUNT_UPDATED",
    entityType: "DepartmentHeadcount",
    entityId: updated.id,
    beforeData: before ? { headcount: before.headcount } : null,
    afterData: { headcount: updated.headcount, fiscalYear },
  });

  return updated;
}
