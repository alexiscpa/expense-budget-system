import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { errorResponse, ApiError } from "@/lib/rbac/guard";

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  const visible = local.slice(0, 1);
  return `${visible}${"*".repeat(Math.max(local.length - 1, 3))}@${domain}`;
}

/**
 * Public, unauthenticated lookup used by /invite/[id] to render "which
 * department is this invitation for" before the visitor has typed anything
 * - deliberately returns no token/tokenHash and only a masked email, so the
 * page itself never becomes a way to enumerate or confirm a full email
 * address.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const invitation = await prisma.invitation.findUnique({
      where: { id: params.id },
      select: {
        status: true,
        email: true,
        expiresAt: true,
        department: { select: { code: true, name: true } },
      },
    });
    if (!invitation) throw new ApiError(404, "找不到此邀請，請確認連結是否正確");

    return NextResponse.json({
      status: invitation.status,
      maskedEmail: maskEmail(invitation.email),
      department: invitation.department,
      expiresAt: invitation.expiresAt,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
