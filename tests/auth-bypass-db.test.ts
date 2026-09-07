import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { createUser } from "./helpers/factory";
import { getCurrentUser } from "@/lib/auth/session";
import { TEST_BYPASS_USER_ID, TEST_BYPASS_USER_NAME, isTestBypassUser } from "@/lib/auth/testBypass";
import { writeAuditLog } from "@/lib/audit/log";
import { prisma } from "@/lib/prisma";

/**
 * DB-backed half of the Preview bypass test suite - split out from
 * auth-bypass.test.ts because every test here needs a live Postgres
 * connection AND a fully generated Prisma Client (query engine binary).
 *
 * KNOWN LIMITATION: in the current sandbox, `prisma generate` cannot fetch
 * its query engine binary because the network egress allowlist does not
 * include binaries.prisma.sh (confirmed: the request returns
 * `x-deny-reason: host_not_allowed`). Merely importing "@/lib/auth/session"
 * or "@/lib/audit/log" pulls in "@/lib/prisma", which eagerly constructs
 * `new PrismaClient()` at module load time - so this entire file fails to
 * even load here, before any test body runs. It has NOT been executed in
 * this environment, and its results here must not be reported as passing.
 * It should be run with `npm test` in an environment that can reach
 * binaries.prisma.sh (or ships a pre-generated client) and has a reachable
 * Postgres instance (matching vitest.config.ts's local test DB URL - never
 * point this at Neon/production).
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

beforeEach(async () => {
  await resetDatabase();
});

describe("getCurrentUser - virtual bypass identity never persisted to the database", () => {
  it("returns a fully virtual TEST_BYPASS_USER identity when Preview bypass is active, and creates no User row", async () => {
    setEnv("preview", "true");
    const user = await getCurrentUser();
    expect(user).not.toBeNull();
    expect(user?.id).toBe(TEST_BYPASS_USER_ID);
    expect(user?.name).toBe(TEST_BYPASS_USER_NAME);
    expect(isTestBypassUser(user)).toBe(true);
    expect(user?.role).toBe("SYSTEM_ADMIN");
    expect(user?.companyWide).toBe(true);
    expect(user?.isActive).toBe(true);
    expect(user?.name).toContain("測試管理員"); // never reads as a real person's name

    const dbUser = await prisma.user.findUnique({ where: { id: TEST_BYPASS_USER_ID } });
    expect(dbUser).toBeNull();
  });
});

describe("audit trail - TEST_BYPASS_USER marking", () => {
  it("writes actorUserId=NULL with a TEST_BYPASS_USER marker in reason, never a fabricated user id", async () => {
    await writeAuditLog({
      actorUserId: TEST_BYPASS_USER_ID,
      action: "DEMO_BYPASS_ACTION",
      entityType: "TestEntity",
      entityId: "demo-1",
    });

    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "DEMO_BYPASS_ACTION" } });
    expect(row.actorUserId).toBeNull();
    expect(row.reason).toContain("TEST_BYPASS_USER");
  });

  it("preserves any existing reason text alongside the TEST_BYPASS_USER marker", async () => {
    await writeAuditLog({
      actorUserId: TEST_BYPASS_USER_ID,
      action: "DEMO_BYPASS_ACTION_WITH_REASON",
      entityType: "TestEntity",
      entityId: "demo-2",
      reason: "手動測試提交流程",
    });

    const row = await prisma.auditLog.findFirstOrThrow({
      where: { action: "DEMO_BYPASS_ACTION_WITH_REASON" },
    });
    expect(row.actorUserId).toBeNull();
    expect(row.reason).toContain("TEST_BYPASS_USER");
    expect(row.reason).toContain("手動測試提交流程");
  });

  it("leaves a real actor id untouched (only the TEST_BYPASS_USER sentinel is stripped)", async () => {
    const realUser = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    await writeAuditLog({
      actorUserId: realUser.id,
      action: "DEMO_REAL_ACTOR_ACTION",
      entityType: "TestEntity",
      entityId: "demo-3",
    });
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "DEMO_REAL_ACTOR_ACTION" } });
    expect(row.actorUserId).toBe(realUser.id);
    expect(row.reason).toBeNull();
  });
});
