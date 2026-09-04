import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { loginSchema } from "@/lib/validation/schemas";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { isAccountLocked, recordLoginFailure, recordLoginSuccess } from "@/lib/auth/rateLimit";
import { assertSameOrigin, clientIp } from "@/lib/security/csrf";
import { writeAuditLog } from "@/lib/audit/log";

// Generic message for every failure case so the response never reveals
// whether an email exists in the system.
const GENERIC_ERROR = "帳號或密碼錯誤";

export async function POST(request: Request) {
  assertSameOrigin(request);
  const ip = clientIp(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
  }
  const { email, password } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

  if (!user || !user.isActive) {
    await recordLoginFailure(email.toLowerCase(), null, ip);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  if (await isAccountLocked(user.id)) {
    // Deliberately still generic - do not tell the caller *why* it failed.
    await recordLoginFailure(email.toLowerCase(), user.id, ip);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    await recordLoginFailure(email.toLowerCase(), user.id, ip);
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 401 });
  }

  await recordLoginSuccess(email.toLowerCase(), user.id, ip);
  await createSession(user.id, user.role, user.companyWide);
  await writeAuditLog({
    actorUserId: user.id,
    action: "LOGIN_SUCCESS",
    entityType: "User",
    entityId: user.id,
    ipAddress: ip,
  });

  return NextResponse.json({
    user: { id: user.id, name: user.name, role: user.role, mustResetPassword: user.mustResetPassword },
  });
}
