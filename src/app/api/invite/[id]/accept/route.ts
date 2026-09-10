import { NextResponse } from "next/server";
import { acceptInvitation, AcceptInvitationError } from "@/lib/invitations/service";
import { acceptInvitationSchema } from "@/lib/validation/schemas";
import { assertSameOrigin, clientIp } from "@/lib/security/csrf";
import { createSession } from "@/lib/auth/session";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  assertSameOrigin(request);
  const ip = clientIp(request);
  const userAgent = request.headers.get("user-agent");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const parsed = acceptInvitationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "請輸入驗證碼" }, { status: 400 });
  }

  try {
    const result = await acceptInvitation({
      invitationId: params.id,
      token: parsed.data.token,
      ipAddress: ip,
      userAgent,
    });

    await createSession(result.userId, result.role, result.companyWide, result.sessionVersion, {
      remember: parsed.data.remember,
    });

    return NextResponse.json({
      department: { code: result.departmentCode, name: result.departmentName },
      email: result.email,
    });
  } catch (err) {
    if (err instanceof AcceptInvitationError) {
      return NextResponse.json({ error: err.message, reason: err.reason }, { status: err.status });
    }
    return NextResponse.json({ error: "驗證失敗，請稍後再試" }, { status: 500 });
  }
}
