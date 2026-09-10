import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getEnv, isProduction, isAuthBypassEnabled } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { testBypassUser } from "@/lib/auth/testBypass";
import type { Role } from "@prisma/client";

const SESSION_COOKIE = "ebs_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours
// "在這台裝置保持登入 15 天" (Stage 2B-3 三部門邀請登入 Pilot, requirement 七)
// - opt-in only, never the default, and only ever extends how long the
// cookie/JWT lives; it grants no capability the normal 8-hour session
// lacks.
const REMEMBER_DEVICE_TTL_SECONDS = 60 * 60 * 24 * 15; // 15 days

export interface SessionPayload {
  sub: string; // user id
  role: Role;
  companyWide: boolean;
  // Must equal the User row's current sessionVersion at verification time -
  // see User.sessionVersion's own schema.prisma doc comment. This is the
  // only way an admin can force an already-issued, otherwise-still-valid
  // JWT to stop working before its natural expiry.
  sessionVersion: number;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

function secretKey() {
  return new TextEncoder().encode(getEnv().SESSION_SECRET);
}

/** How long a session JWT/cookie should live for the given remember choice - a pure lookup, no I/O. */
export function sessionTtlSeconds(remember?: boolean): number {
  return remember ? REMEMBER_DEVICE_TTL_SECONDS : SESSION_TTL_SECONDS;
}

/**
 * Signs a session JWT with no dependency on next/headers' cookies() (which
 * only works inside a live Next.js request context) - split out from
 * createSession purely so this signing/TTL logic is unit-testable directly
 * (see tests/invitationPilot.test.ts), since this codebase has no existing
 * harness for exercising the real cookies()-backed session path at all.
 */
export async function buildSessionToken(
  userId: string,
  role: Role,
  companyWide: boolean,
  sessionVersion: number,
  options?: { remember?: boolean }
): Promise<{ token: string; ttlSeconds: number }> {
  const ttlSeconds = sessionTtlSeconds(options?.remember);
  const token = await new SignJWT({ role, companyWide, sessionVersion } satisfies Partial<SessionPayload>)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(secretKey());
  return { token, ttlSeconds };
}

export async function createSession(
  userId: string,
  role: Role,
  companyWide: boolean,
  sessionVersion: number,
  options?: { remember?: boolean }
) {
  const { token, ttlSeconds } = await buildSessionToken(userId, role, companyWide, sessionVersion, options);

  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: ttlSeconds,
  });
}

export async function destroySession() {
  cookies().set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
}

/** Verifies a raw session JWT string with no dependency on cookies() - see buildSessionToken's own doc comment for why this split exists. */
export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (typeof payload.sub !== "string") return null;
    return payload as unknown as SessionPayload;
  } catch {
    // Expired / tampered token - treat as logged out rather than throwing,
    // since this runs on every request.
    return null;
  }
}

export async function readSession(): Promise<SessionPayload | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  companyWide: boolean;
  isActive: boolean;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  // Test-only bypass: short-circuits before any cookie/DB access. See
  // lib/env.ts#isAuthBypassEnabled for the fail-closed rules governing when
  // this can ever be true, and lib/auth/testBypass.ts for why this identity
  // is fully virtual (no DB row, no password).
  if (isAuthBypassEnabled()) return testBypassUser();

  const session = await readSession();
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.sub } });
  if (!user || !user.isActive) return null;
  // A session issued before an admin's revokeAllSessions() call carries the
  // sessionVersion that was current at issue time - if that no longer
  // matches the User row, the cookie is treated exactly like an expired
  // one (silently logged out), never as a partial/degraded session.
  if (session.sessionVersion !== user.sessionVersion) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    companyWide: user.companyWide,
    isActive: user.isActive,
  };
}
