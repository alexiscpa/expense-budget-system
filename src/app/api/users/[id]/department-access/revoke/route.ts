import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/rbac/guard";
import { revokeDepartmentAccess } from "@/lib/invitations/service";
import { revokeDepartmentAccessSchema } from "@/lib/validation/schemas";
import { assertSameOrigin } from "@/lib/security/csrf";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = await request.json();
    const parsed = revokeDepartmentAccessSchema.parse({ ...body, userId: params.id });
    await revokeDepartmentAccess(user, parsed.userId, parsed.departmentId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
