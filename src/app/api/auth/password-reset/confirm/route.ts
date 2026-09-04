import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { passwordResetConfirmSchema } from "@/lib/validation/schemas";
import { checkPasswordPolicy, hashPassword } from "@/lib/auth/password";
import { assertSameOrigin } from "@/lib/security/csrf";
import { writeAuditLog } from "@/lib/audit/log";

export async function POST(request: Request) {
  assertSameOrigin(request);
  const body = await request.json().catch(() => null);
  const parsed = passwordResetConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const policy = checkPasswordPolicy(parsed.data.newPassword);
  if (!policy.ok) {
    return NextResponse.json({ error: policy.errors.join("; ") }, { status: 422 });
  }

  const tokenHash = crypto.createHash("sha256").update(parsed.data.token).digest("hex");
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "重設密碼連結無效或已過期" }, { status: 400 });
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: record.userId },
      data: { passwordHash, mustResetPassword: false, failedLoginCount: 0, lockedUntil: null },
    }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
  ]);

  await writeAuditLog({
    actorUserId: record.userId,
    action: "PASSWORD_RESET_COMPLETED",
    entityType: "User",
    entityId: record.userId,
  });

  return NextResponse.json({ ok: true });
}
