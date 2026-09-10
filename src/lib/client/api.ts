"use client";

export class ClientApiError extends Error {
  // Optional machine-readable discriminator some routes attach alongside
  // their human-readable `error` message (e.g. the invitation-accept route's
  // AcceptInvitationFailureReason) so a caller can branch on the failure
  // kind without parsing the localized message text.
  reason?: string;
  constructor(message: string, reason?: string) {
    super(message);
    this.reason = reason;
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ClientApiError(body.error ?? "發生未預期的錯誤", body.reason);
  }
  return body as T;
}
