import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/rbac/guard";
import { requestAdjustment } from "@/lib/workflow/actions";
import { reasonSchema } from "@/lib/validation/schemas";
import { assertSameOrigin } from "@/lib/security/csrf";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = await request.json();
    const { reason } = reasonSchema.parse(body);
    const version = await requestAdjustment(user, params.id, reason);
    return NextResponse.json({ version }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
