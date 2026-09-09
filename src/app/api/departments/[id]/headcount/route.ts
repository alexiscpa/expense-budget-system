import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/rbac/guard";
import { assertSameOrigin } from "@/lib/security/csrf";
import { updateHeadcountSchema } from "@/lib/validation/schemas";
import { upsertBudgetYearHeadcount } from "@/lib/budget/headcountService";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = await request.json();
    const parsed = updateHeadcountSchema.parse(body);
    const headcount = await upsertBudgetYearHeadcount(user, params.id, parsed.fiscalYear, parsed.headcount);
    return NextResponse.json({ headcount });
  } catch (err) {
    return errorResponse(err);
  }
}
