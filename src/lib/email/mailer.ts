import "server-only";

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  sent: boolean;
  reason?: "NOT_CONFIGURED" | "PROVIDER_ERROR";
  providerMessageId?: string;
}

/**
 * Whether an outbound email provider is actually configured. Reads
 * RESEND_API_KEY + EMAIL_FROM directly (no envSchema.getEnv() dependency,
 * so this can be safely called even in environments - like this repo's own
 * local dev/test - that never set either) rather than assuming a provider
 * is always available. See sendEmail's own doc comment for why every
 * caller MUST branch on `sent` and never assume `true`.
 */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/**
 * Sends one transactional email via Resend's HTTP API (a plain JSON POST -
 * deliberately implemented with the platform `fetch`, not the `resend` npm
 * package, so this feature adds zero new dependencies while the pilot is
 * still being validated). Swapping to a different provider later only
 * means rewriting this one function - nothing above it (see
 * invitationEmail.ts, the invitation-create route) needs to change.
 *
 * NEVER throws - a misconfigured or down email provider must not break the
 * invitation-creation flow itself (the admin can still see/copy the
 * invitation link and hand the token to the invitee out of band). Callers
 * MUST check `result.sent` and report the true outcome to the operator -
 * never assume delivery succeeded just because this function returned.
 *
 * Deliberately takes only `to`/`subject`/`html`/`text` - there is no token
 * parameter anywhere in this module's API surface, so a caller cannot
 * accidentally wire a token into an email body even by mistake; see
 * invitationEmail.ts, which only ever builds a body containing a URL.
 */
export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  if (!isEmailConfigured()) {
    return { sent: false, reason: "NOT_CONFIGURED" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
      }),
    });

    if (!res.ok) {
      return { sent: false, reason: "PROVIDER_ERROR" };
    }

    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { sent: true, providerMessageId: data.id };
  } catch {
    return { sent: false, reason: "PROVIDER_ERROR" };
  }
}
