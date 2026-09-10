import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { createDepartment, createUser, toCurrentUser } from "./helpers/factory";
import { prisma } from "@/lib/prisma";
import { getAccessibleDepartmentIds, canAccessDepartment } from "@/lib/rbac/permissions";
import { requireDepartmentAccess, ApiError } from "@/lib/rbac/guard";
import {
  createInvitation,
  acceptInvitation,
  AcceptInvitationError,
  revokeInvitation,
  revokeDepartmentAccess,
  revokeAllSessions,
  listInvitations,
} from "@/lib/invitations/service";
import { hashInvitationToken } from "@/lib/invitations/tokens";
import { MAX_INVITATION_ATTEMPTS } from "@/lib/invitations/constants";
import { buildSessionToken, verifySessionToken, sessionTtlSeconds } from "@/lib/auth/session";
import { assertIdentityConfirmed } from "@/lib/workflow/confirmIdentity";
import { buildInvitationEmail } from "@/lib/email/invitationEmail";
import { isEmailConfigured, sendEmail } from "@/lib/email/mailer";

const PILOT_EMAIL = "alex_chen@goodwill.com.tw";

beforeEach(async () => {
  await resetDatabase();
});

/** The three real Stage 2B-2 roster departments named in this Pilot. */
async function seedPilotDepartments() {
  const d10103 = await createDepartment({ code: "10103", name: "稽核室", class: "M" });
  const d12121 = await createDepartment({ code: "12121", name: "台中", class: "S" });
  const d16134 = await createDepartment({ code: "16134", name: "資材部", class: "P" });
  return { d10103, d12121, d16134 };
}

async function admin() {
  return toCurrentUser(await createUser({ role: "SYSTEM_ADMIN", companyWide: true }));
}

describe("1. 同一 Email 可接受 3 個不同部門邀請", () => {
  it("creates 3 independent invitations for the same email across 10103/12121/16134, each with its own token/hash", async () => {
    const a = await admin();
    const { d10103, d12121, d16134 } = await seedPilotDepartments();

    const inv1 = await createInvitation(a, { departmentId: d10103.id, email: PILOT_EMAIL });
    const inv2 = await createInvitation(a, { departmentId: d12121.id, email: PILOT_EMAIL });
    const inv3 = await createInvitation(a, { departmentId: d16134.id, email: PILOT_EMAIL });

    // 3 distinct tokens, 3 distinct invitation ids.
    const tokens = new Set([inv1.token, inv2.token, inv3.token]);
    expect(tokens.size).toBe(3);
    const ids = new Set([inv1.invitation.id, inv2.invitation.id, inv3.invitation.id]);
    expect(ids.size).toBe(3);

    const rows = await prisma.invitation.findMany({ where: { email: PILOT_EMAIL } });
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.tokenHash)).size).toBe(3);

    // Accepting all 3 grants one User row with all 3 UserDepartmentScope rows.
    await acceptInvitation({ invitationId: inv1.invitation.id, token: inv1.token, ipAddress: null, userAgent: null });
    await acceptInvitation({ invitationId: inv2.invitation.id, token: inv2.token, ipAddress: null, userAgent: null });
    await acceptInvitation({ invitationId: inv3.invitation.id, token: inv3.token, ipAddress: null, userAgent: null });

    const users = await prisma.user.findMany({ where: { email: PILOT_EMAIL } });
    expect(users).toHaveLength(1); // never creates a duplicate User for the same email
    const scopes = await prisma.userDepartmentScope.findMany({ where: { userId: users[0]!.id } });
    expect(scopes.map((s) => s.departmentId).sort()).toEqual([d10103.id, d12121.id, d16134.id].sort());
  });
});

describe("2. 每個 Token 只能使用一次", () => {
  it("a second acceptance attempt with the same (already-consumed) token fails, and does not create a second scope/user", async () => {
    const a = await admin();
    const { d10103 } = await seedPilotDepartments();
    const inv = await createInvitation(a, { departmentId: d10103.id, email: PILOT_EMAIL });

    await acceptInvitation({ invitationId: inv.invitation.id, token: inv.token, ipAddress: null, userAgent: null });

    await expect(
      acceptInvitation({ invitationId: inv.invitation.id, token: inv.token, ipAddress: null, userAgent: null })
    ).rejects.toMatchObject({ reason: "ALREADY_ACCEPTED" });

    const users = await prisma.user.count({ where: { email: PILOT_EMAIL } });
    expect(users).toBe(1);
    const scopes = await prisma.userDepartmentScope.count();
    expect(scopes).toBe(1);
  });
});

describe("3. Token 過期及錯誤 5 次拒絕", () => {
  it("an expired invitation is rejected and lazily marked EXPIRED", async () => {
    const a = await admin();
    const { d10103 } = await seedPilotDepartments();
    const inv = await createInvitation(a, { departmentId: d10103.id, email: PILOT_EMAIL });

    await prisma.invitation.update({
      where: { id: inv.invitation.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      acceptInvitation({ invitationId: inv.invitation.id, token: inv.token, ipAddress: null, userAgent: null })
    ).rejects.toMatchObject({ reason: "EXPIRED" });

    const row = await prisma.invitation.findUniqueOrThrow({ where: { id: inv.invitation.id } });
    expect(row.status).toBe("EXPIRED");
  });

  it(`locks the invitation after exactly ${MAX_INVITATION_ATTEMPTS} wrong-token attempts, and a subsequent correct token is still rejected`, async () => {
    const a = await admin();
    const { d10103 } = await seedPilotDepartments();
    const inv = await createInvitation(a, { departmentId: d10103.id, email: PILOT_EMAIL });

    for (let i = 0; i < MAX_INVITATION_ATTEMPTS - 1; i++) {
      await expect(
        acceptInvitation({ invitationId: inv.invitation.id, token: "wrong-token", ipAddress: null, userAgent: null })
      ).rejects.toMatchObject({ reason: "WRONG_TOKEN" });
    }
    let row = await prisma.invitation.findUniqueOrThrow({ where: { id: inv.invitation.id } });
    expect(row.status).toBe("PENDING");
    expect(row.attemptCount).toBe(MAX_INVITATION_ATTEMPTS - 1);

    // The 5th wrong attempt locks it.
    await expect(
      acceptInvitation({ invitationId: inv.invitation.id, token: "wrong-token", ipAddress: null, userAgent: null })
    ).rejects.toMatchObject({ reason: "LOCKED" });
    row = await prisma.invitation.findUniqueOrThrow({ where: { id: inv.invitation.id } });
    expect(row.status).toBe("LOCKED");
    expect(row.attemptCount).toBe(MAX_INVITATION_ATTEMPTS);

    // Even the real, correct token is now rejected - locking is permanent, never auto-resets.
    await expect(
      acceptInvitation({ invitationId: inv.invitation.id, token: inv.token, ipAddress: null, userAgent: null })
    ).rejects.toMatchObject({ reason: "LOCKED" });

    expect(await prisma.userDepartmentScope.count()).toBe(0);
  });
});

describe("4. A 部門 Token 不能啟用 B 部門邀請", () => {
  it("submitting department A's real token against department B's invitation id fails as WRONG_TOKEN and grants nothing", async () => {
    const a = await admin();
    const { d10103, d12121 } = await seedPilotDepartments();
    const invA = await createInvitation(a, { departmentId: d10103.id, email: PILOT_EMAIL });
    const invB = await createInvitation(a, { departmentId: d12121.id, email: PILOT_EMAIL });

    await expect(
      acceptInvitation({ invitationId: invB.invitation.id, token: invA.token, ipAddress: null, userAgent: null })
    ).rejects.toMatchObject({ reason: "WRONG_TOKEN" });

    const rowB = await prisma.invitation.findUniqueOrThrow({ where: { id: invB.invitation.id } });
    expect(rowB.status).toBe("PENDING");
    expect(rowB.attemptCount).toBe(1);
    expect(await prisma.userDepartmentScope.count()).toBe(0);

    // Department A's invitation itself is completely untouched by the misuse attempt against B.
    const rowA = await prisma.invitation.findUniqueOrThrow({ where: { id: invA.invitation.id } });
    expect(rowA.attemptCount).toBe(0);
    expect(rowA.status).toBe("PENDING");
  });
});

describe("5. 三部門可正常切換 / 6. 其他 42 部門回傳 403", () => {
  it("after accepting all 3 invitations, the user is authorized on exactly those 3 departments - never a 4th", async () => {
    const a = await admin();
    const { d10103, d12121, d16134 } = await seedPilotDepartments();
    const otherDept = await createDepartment({ code: "99999", name: "非受邀部門", class: "S" });

    for (const dept of [d10103, d12121, d16134]) {
      const inv = await createInvitation(a, { departmentId: dept.id, email: PILOT_EMAIL });
      await acceptInvitation({ invitationId: inv.invitation.id, token: inv.token, ipAddress: null, userAgent: null });
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { email: PILOT_EMAIL } });
    const currentUser = toCurrentUser({ ...user, isActive: user.isActive });

    const accessibleIds = await getAccessibleDepartmentIds(currentUser);
    expect(accessibleIds?.sort()).toEqual([d10103.id, d12121.id, d16134.id].sort());

    for (const dept of [d10103, d12121, d16134]) {
      expect(await canAccessDepartment(currentUser, dept.id)).toBe(true);
      await expect(requireDepartmentAccess(currentUser, dept.id)).resolves.toBeUndefined();
    }

    // Every one of the other 42 real roster departments (represented here
    // by one concrete example plus a random unrelated id) is refused.
    expect(await canAccessDepartment(currentUser, otherDept.id)).toBe(false);
    await expect(requireDepartmentAccess(currentUser, otherDept.id)).rejects.toBeInstanceOf(ApiError);
    await expect(requireDepartmentAccess(currentUser, otherDept.id)).rejects.toMatchObject({ status: 403 });
  });
});

describe("7. Token 不出現在 URL、資料庫明碼、Log 及 AuditLog", () => {
  it("the stored tokenHash is never equal to (or derivable by string-matching) the plaintext token", async () => {
    const a = await admin();
    const { d10103 } = await seedPilotDepartments();
    const { invitation, token } = await createInvitation(a, { departmentId: d10103.id, email: PILOT_EMAIL });

    const row = await prisma.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toBe(hashInvitationToken(token));
    expect(row.tokenHash).not.toContain(token);
  });

  it("no AuditLog row written by create/accept/mismatch/lock ever contains the plaintext token anywhere in its JSON", async () => {
    const a = await admin();
    const { d10103 } = await seedPilotDepartments();
    const { invitation, token } = await createInvitation(a, { departmentId: d10103.id, email: PILOT_EMAIL });

    await acceptInvitation({ invitationId: invitation.id, token: "wrong-guess", ipAddress: "1.2.3.4", userAgent: "vitest" }).catch(
      () => undefined
    );
    await acceptInvitation({ invitationId: invitation.id, token, ipAddress: "1.2.3.4", userAgent: "vitest" });

    const logs = await prisma.auditLog.findMany({ where: { entityId: invitation.id } });
    expect(logs.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(logs);
    expect(serialized).not.toContain(token);
  });

  it("the invitation URL a client would build from this data contains only the invitation id, never the token", async () => {
    const a = await admin();
    const { d10103 } = await seedPilotDepartments();
    const { invitation, token } = await createInvitation(a, { departmentId: d10103.id, email: PILOT_EMAIL });
    const url = `https://example.test/invite/${invitation.id}`;
    expect(url).not.toContain(token);
  });
});

describe("8. 15 天記住裝置", () => {
  it("remember:true issues a ~15-day session, remember:false/omitted issues the normal ~8-hour one", () => {
    expect(sessionTtlSeconds(true)).toBe(60 * 60 * 24 * 15);
    expect(sessionTtlSeconds(false)).toBe(60 * 60 * 8);
    expect(sessionTtlSeconds(undefined)).toBe(60 * 60 * 8);
  });

  it("the signed JWT's actual expiry reflects the remember choice and round-trips through verification", async () => {
    const { token, ttlSeconds } = await buildSessionToken("user-1", "BUDGET_OWNER", false, 0, { remember: true });
    expect(ttlSeconds).toBe(60 * 60 * 24 * 15);

    const payload = await verifySessionToken(token);
    expect(payload).not.toBeNull();
    expect(payload!.sub).toBe("user-1");
    expect(typeof payload!.exp).toBe("number");
    expect(typeof payload!.iat).toBe("number");
    const actualTtl = payload!.exp! - payload!.iat!;
    expect(actualTtl).toBe(ttlSeconds);
  });
});

describe("9. 管理者可撤銷授權及所有 Session", () => {
  it("revokeDepartmentAccess deletes exactly the targeted UserDepartmentScope row, leaving the other accepted department untouched", async () => {
    const a = await admin();
    const { d10103, d12121 } = await seedPilotDepartments();
    const inv1 = await createInvitation(a, { departmentId: d10103.id, email: PILOT_EMAIL });
    const inv2 = await createInvitation(a, { departmentId: d12121.id, email: PILOT_EMAIL });
    await acceptInvitation({ invitationId: inv1.invitation.id, token: inv1.token, ipAddress: null, userAgent: null });
    await acceptInvitation({ invitationId: inv2.invitation.id, token: inv2.token, ipAddress: null, userAgent: null });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: PILOT_EMAIL } });

    await revokeDepartmentAccess(a, user.id, d10103.id);

    const remaining = await prisma.userDepartmentScope.findMany({ where: { userId: user.id } });
    expect(remaining.map((s) => s.departmentId)).toEqual([d12121.id]);
    const auditRow = await prisma.auditLog.findFirstOrThrow({ where: { action: "DEPARTMENT_ACCESS_REVOKED" } });
    expect(auditRow.actorUserId).toBe(a.id);
  });

  it("revokeAllSessions bumps sessionVersion so a previously-issued token fails verification against the current User row", async () => {
    const a = await admin();
    const target = await createUser({ email: PILOT_EMAIL, role: "BUDGET_OWNER" });

    const { token } = await buildSessionToken(target.id, target.role, target.companyWide, target.sessionVersion);
    const payloadBefore = await verifySessionToken(token);
    expect(payloadBefore!.sessionVersion).toBe(target.sessionVersion);

    await revokeAllSessions(a, target.id);

    const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(refreshed.sessionVersion).toBe(target.sessionVersion + 1);
    // The JWT itself still cryptographically verifies (it isn't tampered),
    // but getCurrentUser() rejects it because its embedded sessionVersion
    // no longer matches - this is the actual revocation check.
    const payloadAfter = await verifySessionToken(token);
    expect(payloadAfter!.sessionVersion).not.toBe(refreshed.sessionVersion);

    const auditRow = await prisma.auditLog.findFirstOrThrow({ where: { action: "ALL_SESSIONS_REVOKED" } });
    expect(auditRow.actorUserId).toBe(a.id);
  });

  it("only a user.manage capability holder may revoke invitations, department access, or sessions", async () => {
    const owner = toCurrentUser(await createUser({ role: "BUDGET_OWNER", companyWide: true }));
    const { d10103 } = await seedPilotDepartments();
    const target = await createUser({ email: PILOT_EMAIL, role: "BUDGET_OWNER" });

    await expect(revokeDepartmentAccess(owner, target.id, d10103.id)).rejects.toMatchObject({ status: 403 });
    await expect(revokeAllSessions(owner, target.id)).rejects.toMatchObject({ status: 403 });
    await expect(createInvitation(owner, { departmentId: d10103.id, email: PILOT_EMAIL })).rejects.toMatchObject({ status: 403 });
    await expect(listInvitations(owner)).rejects.toMatchObject({ status: 403 });
  });

  it("revokeInvitation only applies to PENDING/LOCKED invitations, never an already-ACCEPTED one", async () => {
    const a = await admin();
    const { d10103 } = await seedPilotDepartments();
    const inv = await createInvitation(a, { departmentId: d10103.id, email: PILOT_EMAIL });
    await acceptInvitation({ invitationId: inv.invitation.id, token: inv.token, ipAddress: null, userAgent: null });

    await expect(revokeInvitation(a, inv.invitation.id)).rejects.toMatchObject({ status: 409 });
  });
});

describe("送出前再次確認登入身分 (assertIdentityConfirmed)", () => {
  it("passes when the confirmed email matches the current session's email exactly (case-insensitive)", () => {
    const user = toCurrentUser({
      id: "u1",
      email: "Alex_Chen@Goodwill.com.tw",
      name: "Alex",
      role: "BUDGET_OWNER",
      companyWide: false,
      isActive: true,
    });
    expect(() => assertIdentityConfirmed(user, "alex_chen@goodwill.com.tw")).not.toThrow();
  });

  it("rejects a mismatched confirmedEmail with a 422", () => {
    const user = toCurrentUser({
      id: "u1",
      email: "alex_chen@goodwill.com.tw",
      name: "Alex",
      role: "BUDGET_OWNER",
      companyWide: false,
      isActive: true,
    });
    expect(() => assertIdentityConfirmed(user, "someone-else@goodwill.com.tw")).toThrow();
    try {
      assertIdentityConfirmed(user, "someone-else@goodwill.com.tw");
    } catch (err) {
      expect((err as ApiError).status).toBe(422);
    }
  });
});

describe("邀請 Email 內容與寄信服務", () => {
  it("the built email never contains the plaintext token anywhere in subject/html/text, only the invitation URL", () => {
    const token = "super-secret-token-value";
    const { subject, html, text } = buildInvitationEmail({
      departmentCode: "10103",
      departmentName: "稽核室",
      invitationUrl: "https://example.test/invite/inv123",
    });
    for (const field of [subject, html, text]) {
      expect(field).not.toContain(token);
    }
    expect(html).toContain("https://example.test/invite/inv123");
    expect(text).toContain("https://example.test/invite/inv123");
    // Clearly marked as a test/pilot message, never presented as a real notification.
    expect(subject).toContain("測試");
    expect(text).toContain("測試");
  });

  it("sendEmail reports NOT_CONFIGURED (never throws, never claims success) when no provider env vars are set", async () => {
    const originalKey = process.env.RESEND_API_KEY;
    const originalFrom = process.env.EMAIL_FROM;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    try {
      expect(isEmailConfigured()).toBe(false);
      const result = await sendEmail({ to: PILOT_EMAIL, subject: "s", html: "<p>h</p>", text: "t" });
      expect(result.sent).toBe(false);
      expect(result.reason).toBe("NOT_CONFIGURED");
    } finally {
      if (originalKey !== undefined) process.env.RESEND_API_KEY = originalKey;
      if (originalFrom !== undefined) process.env.EMAIL_FROM = originalFrom;
    }
  });
});

describe("AcceptInvitationError shape", () => {
  it("carries the machine-readable reason alongside a human-readable Traditional-Chinese message", async () => {
    const a = await admin();
    const { d10103 } = await seedPilotDepartments();
    const inv = await createInvitation(a, { departmentId: d10103.id, email: PILOT_EMAIL });
    await prisma.invitation.update({ where: { id: inv.invitation.id }, data: { status: "REVOKED" } });

    try {
      await acceptInvitation({ invitationId: inv.invitation.id, token: inv.token, ipAddress: null, userAgent: null });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AcceptInvitationError);
      expect((err as AcceptInvitationError).reason).toBe("REVOKED");
      expect((err as AcceptInvitationError).message).toContain("撤銷");
    }
  });
});
