import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/rbac/guard";
import { rejectBudgetVersion } from "@/lib/workflow/actions";
import { reasonSchema } from "@/lib/validation/schemas";
import { assertSameOrigin } from "@/lib/security/csrf";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = await request.json();
    const { reason } = reasonSchema.parse(body);
    const version = await rejectBudgetVersion(user, params.id, reason);
    return NextResponse.json({ version });
  } catch (err) {
    return errorResponse(err);
  }
}
