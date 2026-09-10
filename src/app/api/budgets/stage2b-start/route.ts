import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, errorResponse } from "@/lib/rbac/guard";
import { startStage2bPreparation } from "@/lib/budget/stage2bDraftService";
import { assertSameOrigin } from "@/lib/security/csrf";

const startSchema = z.object({
  departmentId: z.string().min(1, "缺少部門 ID"),
});

/**
 * "開始編製" for the Stage 2B-2 45-department roster - the only way a 2027
 * BudgetVersion is created for one of these departments (see
 * stage2bDraftService.ts's own doc comment for why this must stay
 * on-demand, never a batch pre-creation of all 45).
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = await request.json();
    const parsed = startSchema.parse(body);
    const version = await startStage2bPreparation(user, parsed.departmentId);
    return NextResponse.json({ version }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
