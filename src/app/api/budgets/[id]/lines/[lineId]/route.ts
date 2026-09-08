import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/rbac/guard";
import { updateDepartmentInputLine } from "@/lib/budget/lineService";
import { updateLineSchema } from "@/lib/validation/schemas";
import { assertSameOrigin } from "@/lib/security/csrf";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: Request, { params }: { params: { id: string; lineId: string } }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = await request.json();
    const parsed = updateLineSchema.parse(body);
    const line = await updateDepartmentInputLine(user, params.id, params.lineId, parsed);
    // lastPreparedAt lives on the parent BudgetVersion, not this BudgetLine
    // (see its schema comment) - fetched separately so the screen can
    // reflect it immediately after a successful save without a full page
    // reload, without changing updateDepartmentInputLine's own return shape
    // (a BudgetLine, relied on as-is by existing tests/routes).
    const version = await prisma.budgetVersion.findUniqueOrThrow({
      where: { id: params.id },
      select: { lastPreparedAt: true },
    });
    return NextResponse.json({ line, lastPreparedAt: version.lastPreparedAt });
  } catch (err) {
    return errorResponse(err);
  }
}
