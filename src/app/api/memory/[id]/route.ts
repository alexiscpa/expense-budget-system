import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/rbac/guard";
import { deleteOwnMemoryEntry } from "@/lib/memory/service";
import { assertSameOrigin } from "@/lib/security/csrf";

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await deleteOwnMemoryEntry(user, params.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
