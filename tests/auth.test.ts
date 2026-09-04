import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { createUser } from "./helpers/factory";
import { hashPassword, verifyPassword, checkPasswordPolicy } from "@/lib/auth/password";
import { isAccountLocked, recordLoginFailure, recordLoginSuccess } from "@/lib/auth/rateLimit";
import { prisma } from "@/lib/prisma";

beforeEach(async () => {
  await resetDatabase();
});

describe("password hashing", () => {
  it("never stores the plaintext password and verifies correctly", async () => {
    const hash = await hashPassword("Sup3r-Secret!!");
    expect(hash).not.toBe("Sup3r-Secret!!");
    expect(await verifyPassword("Sup3r-Secret!!", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("enforces a minimum password policy", () => {
    expect(checkPasswordPolicy("short").ok).toBe(false);
    expect(checkPasswordPolicy("alllowercase12345").ok).toBe(false);
    expect(checkPasswordPolicy("Valid-Password-123!").ok).toBe(true);
  });
});

describe("login lockout (rate limiting)", () => {
  it("locks the account after 5 consecutive failures and clears on success", async () => {
    const user = await createUser({ email: "lockout@example.com" });

    for (let i = 0; i < 4; i++) {
      await recordLoginFailure(user.email, user.id, "127.0.0.1");
      expect(await isAccountLocked(user.id)).toBe(false);
    }

    await recordLoginFailure(user.email, user.id, "127.0.0.1");
    expect(await isAccountLocked(user.id)).toBe(true);

    // A correct password after lockout is still rejected until the lock
    // expires - the route layer checks isAccountLocked() before verifying
    // the password, so recordLoginSuccess is only reached once unlocked.
    const locked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(locked.lockedUntil).not.toBeNull();

    await recordLoginSuccess(user.email, user.id, "127.0.0.1");
    expect(await isAccountLocked(user.id)).toBe(false);
    const unlocked = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(unlocked.failedLoginCount).toBe(0);
  });

  it("records every attempt in LoginAttempt for audit purposes", async () => {
    const user = await createUser({ email: "audit-attempts@example.com" });
    await recordLoginFailure(user.email, user.id, "10.0.0.1");
    await recordLoginSuccess(user.email, user.id, "10.0.0.1");

    const attempts = await prisma.loginAttempt.findMany({ where: { email: user.email } });
    expect(attempts).toHaveLength(2);
    expect(attempts.some((a) => a.success === false)).toBe(true);
    expect(attempts.some((a) => a.success === true)).toBe(true);
  });
});
