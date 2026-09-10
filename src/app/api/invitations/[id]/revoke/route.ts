import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/rbac/guard";
import { revokeInvitation } from "@/lib/invitations/service";
import { assertSameOrigin } from "@/lib/security/csrf";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await revokeInvitation(user, params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
