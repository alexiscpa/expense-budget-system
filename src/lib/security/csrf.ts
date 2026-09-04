import { ApiError } from "@/lib/rbac/guard";

/**
 * Defense-in-depth CSRF check for state-changing API routes. The session
 * cookie is SameSite=Lax (blocks most cross-site POSTs already), and this
 * adds an Origin/Referer same-site check so a request forged from another
 * origin is rejected even if a browser's SameSite handling is bypassed.
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return; // same-origin navigations/fetches from same-site pages may omit Origin
  const host = request.headers.get("host");
  try {
    const originHost = new URL(origin).host;
    if (host && originHost !== host) {
      throw new ApiError(403, "跨來源請求已被拒絕");
    }
  } catch {
    throw new ApiError(403, "無效的請求來源");
  }
}

export function clientIp(request: Request): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}
