import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { passwordResetRequestSchema } from "@/lib/validation/schemas";
import { assertSameOrigin } from "@/lib/security/csrf";

const GENERIC_MESSAGE = "若此電子郵件存在於系統中，重設密碼的說明已送出";

/**
 * Always returns the same generic message regardless of whether the email
 * exists, to avoid account enumeration. The reset token itself is returned
 * here only because this project has no outbound email integration yet
 * (see OPERATIONS.md); wiring this to a real mail provider is a P0 item
 * before go-live so the token is never exposed in an HTTP response.
 */
export async function POST(request: Request) {
  assertSameOrigin(request);
  const body = await request.json().catch(() => null);
  const parsed = passwordResetRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ message: GENERIC_MESSAGE });
  }

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
  if (!user || !user.isActive) {
    return NextResponse.json({ message: GENERIC_MESSAGE });
  }

  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  await prisma.passwordResetToken.create({
    data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 1000 * 60 * 30) },
  });

  return NextResponse.json({
    message: GENERIC_MESSAGE,
    // TODO(P0-before-launch): deliver via email instead of returning in the response.
    devOnlyResetToken: process.env.NODE_ENV === "production" ? undefined : token,
  });
}
