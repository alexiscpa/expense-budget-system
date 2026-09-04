import { NextResponse } from "next/server";
import { destroySession, getCurrentUser } from "@/lib/auth/session";
import { assertSameOrigin } from "@/lib/security/csrf";
import { writeAuditLog } from "@/lib/audit/log";

export async function POST(request: Request) {
  assertSameOrigin(request);
  const user = await getCurrentUser();
  await destroySession();
  if (user) {
    await writeAuditLog({ actorUserId: user.id, action: "LOGOUT", entityType: "User", entityId: user.id });
  }
  return NextResponse.json({ ok: true });
}
