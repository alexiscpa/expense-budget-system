import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { isAuthBypassEnabled } from "@/lib/env";
import { middleware } from "@/middleware";

/**
 * Everything in this file is intentionally free of any database/Prisma
 * dependency, so it can run in environments where `prisma generate` cannot
 * fetch its query engine binary (see README.md / VERCEL_DEPLOYMENT.md for
 * the documented sandbox limitation). DB-backed bypass behaviour (audit log
 * writes, "no User row created") lives in auth-bypass-db.test.ts instead,
 * clearly separated so it's obvious which suite actually ran.
 *
 * vitest.config.ts sets NODE_ENV=test globally for every test in this
 * suite; VERCEL_ENV and AUTH_DISABLED are not part of that fixed env block,
 * so each test below sets/clears them explicitly and restores the original
 * values afterwards to avoid leaking state into other test files
 * (fileParallelism is disabled, but tests within a file still share
 * process.env).
 */
const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;
const ORIGINAL_AUTH_DISABLED = process.env.AUTH_DISABLED;

function setEnv(vercelEnv: string | undefined, authDisabled: string | undefined) {
  if (vercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = vercelEnv;

  if (authDisabled === undefined) delete process.env.AUTH_DISABLED;
  else process.env.AUTH_DISABLED = authDisabled;
}

afterEach(() => {
  setEnv(ORIGINAL_VERCEL_ENV, ORIGINAL_AUTH_DISABLED);
});

describe("isAuthBypassEnabled - fail-closed, Preview-only gating", () => {
  it("is off when AUTH_DISABLED is unset, regardless of VERCEL_ENV", () => {
    setEnv("preview", undefined);
    expect(isAuthBypassEnabled()).toBe(false);
  });

  it("is off when AUTH_DISABLED=false, regardless of VERCEL_ENV", () => {
    setEnv("preview", "false");
    expect(isAuthBypassEnabled()).toBe(false);
  });

  it("is off for any near-miss AUTH_DISABLED value - only the exact string 'true' counts", () => {
    for (const value of ["1", "TRUE", "True", "yes", "YES", "on", " true", "true "]) {
      setEnv("preview", value);
      expect(isAuthBypassEnabled(), `AUTH_DISABLED=${JSON.stringify(value)} must not enable bypass`).toBe(false);
    }
  });

  it("is ON only when VERCEL_ENV=preview AND AUTH_DISABLED=true", () => {
    setEnv("preview", "true");
    expect(isAuthBypassEnabled()).toBe(true);
  });

  it("is off in Production even when AUTH_DISABLED=true - no override flag exists", () => {
    setEnv("production", "true");
    expect(isAuthBypassEnabled()).toBe(false);
  });

  it("is off outside Vercel (VERCEL_ENV unset, e.g. local dev/CI) even when AUTH_DISABLED=true", () => {
    setEnv(undefined, "true");
    expect(isAuthBypassEnabled()).toBe(false);
  });

  it("is off in the Vercel 'development' environment even when AUTH_DISABLED=true", () => {
    setEnv("development", "true");
    expect(isAuthBypassEnabled()).toBe(false);
  });
});

describe("middleware - Preview bypass skips the /login redirect", () => {
  it("redirects unauthenticated requests to /login when bypass is off", async () => {
    setEnv("preview", "false");
    const res = await middleware(new NextRequest(new URL("https://example.com/dashboard")));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("lets the request through without a session cookie when Preview bypass is on", async () => {
    setEnv("preview", "true");
    const res = await middleware(new NextRequest(new URL("https://example.com/dashboard")));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("still redirects to /login in Production, even with AUTH_DISABLED=true", async () => {
    setEnv("production", "true");
    const res = await middleware(new NextRequest(new URL("https://example.com/dashboard")));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("does not touch routes outside /dashboard regardless of bypass state", async () => {
    setEnv("preview", "false");
    const res = await middleware(new NextRequest(new URL("https://example.com/")));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("/login page - bypass notice replaces the credential form", () => {
  // Rendering .tsx components directly isn't part of this project's test
  // conventions (see tests/audit.test.ts for the same style) and the
  // Next.js JSX runtime isn't configured for vitest's own transform, so
  // this checks the page's source directly rather than rendering it -
  // consistent with the rest of the suite and avoiding an unrelated
  // toolchain change just for this feature.
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "app", "login", "page.tsx"), "utf-8");

  it("branches on isAuthBypassEnabled() and shows the Demo bypass notice with a home link", () => {
    expect(source).toMatch(/isAuthBypassEnabled\(\)/);
    expect(source).toContain("目前已啟用 Demo 測試環境免登入模式");
    expect(source).toContain("TEST_BYPASS_USER");
    expect(source).toMatch(/<Link\s+href="\/"/);
  });

  it("delegates to the real LoginForm credential component on the non-bypass path", () => {
    expect(source).toMatch(/return <LoginForm\s*\/>/);
  });

  it("LoginForm.tsx (the real credential form) was preserved unchanged as a client component with a password field", () => {
    const formSource = fs.readFileSync(
      path.join(__dirname, "..", "src", "app", "login", "LoginForm.tsx"),
      "utf-8"
    );
    expect(formSource).toMatch(/^"use client";/);
    expect(formSource).toMatch(/type="password"/);
    expect(formSource).toMatch(/export function LoginForm/);
  });
});

describe("static safety checks - bypass mode never touches auth/RBAC internals", () => {
  const root = path.join(__dirname, "..");
  const read = (relPath: string) => fs.readFileSync(path.join(root, relPath), "utf-8");

  it("rbac/guard.ts still enforces requireUser/requireCapability/requireDepartmentAccess - none were removed", () => {
    const source = read("src/lib/rbac/guard.ts");
    expect(source).toMatch(/export async function requireUser/);
    expect(source).toMatch(/export async function requireCapability/);
    expect(source).toMatch(/export async function requireDepartmentAccess/);
    // The only bypass-specific logic ever spliced into the RBAC guard is a
    // narrow, explicit allowlist of two budget capabilities for the virtual
    // TEST_BYPASS_USER identity (see lib/rbac/guard.ts#TEST_BYPASS_EXTRA_CAPABILITIES),
    // so the Preview demo admin can hand-build a test budget. It must never
    // reference the raw env-var gate directly (that fail-closed check lives
    // solely in lib/env.ts#isAuthBypassEnabled), and must never grant
    // review/approve/return/reject/adjustment capabilities - doing so would
    // let a single identity bypass segregation-of-duties controls.
    expect(source).not.toMatch(/AUTH_DISABLED|isAuthBypassEnabled/);
    expect(source).toMatch(/TEST_BYPASS_EXTRA_CAPABILITIES/);
    expect(source).not.toMatch(/budget\.approve|budget\.finance_review|budget\.return|budget\.adjustment|budget\.department_review/);
  });

  it("rbac/permissions.ts still defines the full role capability matrix - no capability was stripped for bypass", () => {
    const source = read("src/lib/rbac/permissions.ts");
    for (const role of [
      "SYSTEM_ADMIN",
      "BUDGET_OWNER",
      "DEPARTMENT_EDITOR",
      "DEPARTMENT_REVIEWER",
      "FINANCE_REVIEWER",
      "FINANCE_APPROVER",
      "READ_ONLY",
      "AUDITOR",
    ]) {
      expect(source).toContain(role);
    }
    expect(source).not.toMatch(/AUTH_DISABLED|isAuthBypassEnabled|TEST_BYPASS/);
  });

  it("middleware.ts still verifies the real session JWT on the non-bypass path", () => {
    const source = read("src/middleware.ts");
    expect(source).toMatch(/jwtVerify/);
    expect(source).toMatch(/isAuthBypassEnabled/);
  });

  it("session.ts still signs/reads real JWT sessions - createSession/destroySession/readSession are all present", () => {
    const source = read("src/lib/auth/session.ts");
    expect(source).toMatch(/export async function createSession/);
    expect(source).toMatch(/export async function destroySession/);
    expect(source).toMatch(/export async function readSession/);
    expect(source).toMatch(/SignJWT/);
  });

  it("password hashing/policy code was not touched or removed", () => {
    const source = read("src/lib/auth/password.ts");
    expect(source).toMatch(/bcrypt/i);
    expect(source).toMatch(/export (async )?function (hashPassword|checkPasswordPolicy)/);
  });

  it("testBypass.ts never calls prisma.user.create/upsert - the identity is never persisted", () => {
    const source = read("src/lib/auth/testBypass.ts");
    expect(source).not.toMatch(/prisma\.user\.(create|upsert)/);
    expect(source).not.toMatch(/passwordHash/);
  });

  it("no source file under src/ hardcodes a literal password/secret value for the bypass identity", () => {
    const srcDir = path.join(root, "src");
    const offenders: string[] = [];
    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          const source = fs.readFileSync(full, "utf-8");
          // Looks for an assigned literal password/secret string (not an
          // env var reference, not a UI label like "密碼"/"password" used as
          // a form label or property name).
          if (/(password|secret)\s*[:=]\s*["'](?!process\.env)[^"']{6,}["']/i.test(source)) {
            offenders.push(path.relative(root, full));
          }
        }
      }
    }
    walk(srcDir);
    expect(offenders).toEqual([]);
  });

  it("package.json build/postinstall never runs migrate/seed (bypass mode changes no deployment step)", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts.build).toBe("next build");
    expect(pkg.scripts.postinstall ?? "").not.toMatch(/migrate|seed/);
  });

  it(".env* files are git-ignored - no real secrets can be committed", () => {
    const gitignore = read(".gitignore");
    expect(gitignore).toMatch(/^\.env(\*|\.local)?/m);
  });
});
