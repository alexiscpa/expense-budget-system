import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/rbac/guard";
import { updateBudgetYearHeadcount } from "@/lib/budget/headcountService";
import { updateHeadcountSchema } from "@/lib/validation/schemas";
import { assertSameOrigin } from "@/lib/security/csrf";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = await request.json();
    const parsed = updateHeadcountSchema.parse(body);
    const version = await updateBudgetYearHeadcount(user, params.id, parsed.budgetYearHeadcount);
    return NextResponse.json({ version });
  } catch (err) {
    return errorResponse(err);
  }
}
