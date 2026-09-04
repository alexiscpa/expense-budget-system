import { requireUser, errorResponse } from "@/lib/rbac/guard";
import { exportApprovedBudgetVersion } from "@/lib/excel/exportBudgetLines";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const buffer = await exportApprovedBudgetVersion(user, params.id);
    return new Response(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="budget-${params.id}.xlsx"`,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
