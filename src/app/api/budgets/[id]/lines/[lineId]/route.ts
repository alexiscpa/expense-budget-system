import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/rbac/guard";
import { updateDepartmentInputLine } from "@/lib/budget/lineService";
import { updateLineSchema } from "@/lib/validation/schemas";
import { assertSameOrigin } from "@/lib/security/csrf";

export async function PATCH(request: Request, { params }: { params: { id: string; lineId: string } }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = await request.json();
    const parsed = updateLineSchema.parse(body);
    const line = await updateDepartmentInputLine(user, params.id, params.lineId, parsed);
    return NextResponse.json({ line });
  } catch (err) {
    return errorResponse(err);
  }
}
