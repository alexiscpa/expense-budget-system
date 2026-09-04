import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "@/lib/auth/session";
import { requireCapability, requireDepartmentAccess, ApiError } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/log";
import { sanitizeCellText } from "@/lib/excel/sanitize";
import { BUDGET_LINE_TEMPLATE_HEADERS } from "@/lib/excel/importBudgetLines";

/**
 * Official report export. Only LOCKED/ADJUSTED (approved) versions are ever
 * included - draft/submitted/under-review figures must never appear in an
 * "official" export, per docs instruction §八.6 / §二.12.
 */
export async function exportApprovedBudgetVersion(user: CurrentUser, versionId: string): Promise<Buffer> {
  await requireCapability(user, "report.export_official");

  const version = await prisma.budgetVersion.findUnique({
    where: { id: versionId },
    include: { lines: { include: { account: true } }, department: true },
  });
  if (!version) throw new ApiError(404, "找不到此預算版本");
  await requireDepartmentAccess(user, version.departmentId);

  if (version.status !== "LOCKED" && version.status !== "ADJUSTED") {
    throw new ApiError(422, "正式報表只包含已核准（鎖定）版本，此版本尚未核准");
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "expense-budget-system";
  const sheet = workbook.addWorksheet(sanitizeCellText(`${version.department.name}_${version.fiscalYear}`));

  sheet.addRow([...BUDGET_LINE_TEMPLATE_HEADERS, "合計(含新員)", "不含新員成長率", "含新員成長率"]);

  for (const line of version.lines) {
    sheet.addRow([
      sanitizeCellText(line.account.code),
      line.account.code,
      sanitizeCellText(line.account.name),
      line.priorPriorYearActual.toString(),
      line.priorYearOriginalBudget.toString(),
      line.currentYearProjection ? line.currentYearProjection.toString() : "資料不全，待確認",
      line.nextYearTargetExcludingNew.toString(),
      line.nextYearNewHireBudget.toString(),
      line.nextYearTotal.toString(),
      line.growthRateExcludingNew ? line.growthRateExcludingNew.toString() : "",
      line.growthRateIncludingNew ? line.growthRateIncludingNew.toString() : "",
    ]);
  }

  const buffer = await workbook.xlsx.writeBuffer();

  await writeAuditLog({
    actorUserId: user.id,
    action: "REPORT_EXPORTED",
    entityType: "BudgetVersion",
    entityId: versionId,
    afterData: { status: version.status },
  });

  return Buffer.from(buffer);
}
