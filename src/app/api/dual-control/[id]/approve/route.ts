import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/rbac/guard";
import { approveDualControlRequest } from "@/lib/security/dualControl";
import { assertSameOrigin } from "@/lib/security/csrf";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const updated = await approveDualControlRequest(user, params.id);
    return NextResponse.json({ request: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
