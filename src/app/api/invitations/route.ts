import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/rbac/guard";
import { createInvitation, listInvitations } from "@/lib/invitations/service";
import { createInvitationSchema } from "@/lib/validation/schemas";
import { assertSameOrigin } from "@/lib/security/csrf";
import { prisma } from "@/lib/prisma";
import { sendEmail, isEmailConfigured } from "@/lib/email/mailer";
import { buildInvitationEmail, buildInvitationUrl } from "@/lib/email/invitationEmail";

export async function GET() {
  try {
    const user = await requireUser();
    const invitations = await listInvitations(user);
    return NextResponse.json({ invitations });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = await request.json();
    const parsed = createInvitationSchema.parse(body);
    const { invitation, token } = await createInvitation(user, parsed);

    // Email delivery is a best-effort side effect, never the source of
    // truth for whether the invitation was created - the invitation row
    // above always exists regardless of what happens here. See requirement
    // 「若寄信服務尚未設定，先用Preview管理者畫面產生邀請，但不得假裝已寄送
    // 成功」: emailSent below is always the REAL outcome, never assumed true.
    let emailSent = false;
    let emailReason: string | undefined;
    if (!isEmailConfigured()) {
      emailReason = "NOT_CONFIGURED";
    } else {
      const department = await prisma.department.findUniqueOrThrow({ where: { id: invitation.departmentId } });
      const invitationUrl = buildInvitationUrl(invitation.id);
      const { subject, html, text } = buildInvitationEmail({
        departmentCode: department.code,
        departmentName: department.name,
        invitationUrl,
      });
      const result = await sendEmail({ to: invitation.email, subject, html, text });
      emailSent = result.sent;
      emailReason = result.reason;
    }

    // `token` is returned exactly once, in this response, to the admin who
    // just created the invitation - see createInvitation's own doc comment.
    // Never re-fetchable afterwards (only tokenHash is stored), and the
    // caller must never persist/log it beyond displaying it to the operator.
    return NextResponse.json({ invitation, token, emailSent, emailReason }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
