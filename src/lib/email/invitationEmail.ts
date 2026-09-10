import "server-only";
import { getEnv } from "@/lib/env";

/**
 * Builds the absolute invitation URL from APP_BASE_URL + the invitation's
 * public id - never the token (see the Invitation model's own doc comment:
 * the token must never appear in a URL, only entered by hand on the page
 * this URL points to). Throws rather than silently falling back to a
 * relative or empty URL if APP_BASE_URL isn't configured, since an email
 * with a broken link is worse than no email at all - the invitation-create
 * flow surfaces this as "email not sent" (see the mailer's NOT_CONFIGURED
 * path) rather than sending something unusable.
 */
export function buildInvitationUrl(invitationId: string): string {
  const base = getEnv().APP_BASE_URL;
  if (!base) {
    throw new Error("APP_BASE_URL 尚未設定，無法產生邀請網址");
  }
  return `${base.replace(/\/+$/, "")}/invite/${invitationId}`;
}

export interface InvitationEmailParams {
  departmentCode: string;
  departmentName: string;
  invitationUrl: string;
}

/**
 * Content-only builder - deliberately takes no token parameter anywhere in
 * its signature, so it is structurally impossible for a caller to embed
 * one in the body even by mistake (見需求三「邀請Email只寄送邀請網址，不得
 * 包含明碼Token」). The verification code itself must be relayed to the
 * invitee through a separate channel (see the admin invitation-create
 * response, which is the only place the plaintext token is ever shown).
 *
 * Every string here is unambiguously marked as a test/pilot message per
 * requirement 「寄件者名稱及信件內容清楚標示為測試」 - the recommended
 * EMAIL_FROM value (see OPERATIONS notes) is something like
 * "費用預算系統（測試）<noreply@goodwill.com.tw>" so the sender name itself
 * also carries the same marking, not just the body.
 */
export function buildInvitationEmail(params: InvitationEmailParams): { subject: string; html: string; text: string } {
  const subject = `【測試邀請】費用預算系統 - ${params.departmentName}（${params.departmentCode}）存取邀請`;

  const text = [
    "【本郵件為費用預算系統 Pilot 測試邀請，非正式系統通知】",
    "",
    `您已被邀請以「${params.departmentName}（${params.departmentCode}）」部門的身分加入費用預算系統測試。`,
    "",
    `請開啟以下網址開始驗證：${params.invitationUrl}`,
    "",
    "驗證碼將由系統管理者另行提供給您，請勿在此郵件中尋找驗證碼。",
    "此邀請連結 21 天內有效，且驗證碼僅能成功使用一次。",
    "",
    "若您並非受邀對象，請忽略此郵件。",
  ].join("\n");

  const html = `
    <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
      <p style="background:#fef3c7;color:#92400e;padding:8px 12px;border-radius:4px;font-weight:bold;">
        本郵件為費用預算系統 Pilot 測試邀請，非正式系統通知
      </p>
      <p>您已被邀請以「<strong>${params.departmentName}（${params.departmentCode}）</strong>」部門的身分加入費用預算系統測試。</p>
      <p><a href="${params.invitationUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;">開始驗證</a></p>
      <p style="color:#64748b;font-size:13px;">驗證碼將由系統管理者另行提供給您，請勿在此郵件中尋找驗證碼。此邀請連結 21 天內有效，且驗證碼僅能成功使用一次。</p>
      <p style="color:#94a3b8;font-size:12px;">若您並非受邀對象，請忽略此郵件。</p>
    </div>
  `;

  return { subject, html, text };
}
