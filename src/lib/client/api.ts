"use client";

export class ClientApiError extends Error {}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ClientApiError(body.error ?? "發生未預期的錯誤");
  }
  return body as T;
}
