import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "@/lib/auth/session";
import { requireCapability, ApiError } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/log";
import { hashPassword } from "@/lib/auth/password";
import { generateInvitationToken, hashInvitationToken } from "./tokens";
import { INVITATION_TTL_DAYS, MAX_INVITATION_ATTEMPTS } from "./constants";

export interface CreateInvitationResult {
  invitation: { id: string; departmentId: string; email: string; expiresAt: Date };
  /**
   * The ONE and ONLY time the plaintext token is ever available anywhere in
   * this system - the caller (the admin invitation-create API route) must
   * display it to the operator and then discard it; nothing here or
   * upstream persists it, and it must never be written to a log line, an
   * AuditLog row, or the invitation email (see the email template's own
   * doc comment - it links to /invite/[id] only).
   */
  token: string;
}

/**
 * Creates one department-scoped invitation. Requires "user.manage"
 * (SYSTEM_ADMIN today) - the same capability that already gates every other
 * account-provisioning action in this app (see ROLE_CAPABILITIES).
 *
 * Deliberately allows the same email to hold multiple independent, live
 * invitations across different departments at once - see the Invitation
 * model's own schema.prisma doc comment for why this must never be
 * collapsed into "one invitation per email".
 */
export async function createInvitation(
  admin: CurrentUser,
  params: { departmentId: string; email: string }
): Promise<CreateInvitationResult> {
  await requireCapability(admin, "user.manage");

  const email = params.email.trim().toLowerCase();
  const department = await prisma.department.findUnique({ where: { id: params.departmentId } });
  if (!department || !department.isActive) {
    throw new ApiError(404, "找不到此部門或該部門已停用");
  }

  const token = generateInvitationToken();
  const tokenHash = hashInvitationToken(token);
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const invitation = await prisma.invitation.create({
    data: {
      departmentId: department.id,
      email,
      tokenHash,
      expiresAt,
      createdById: admin.id,
    },
  });

  // Never include token/tokenHash in the audit trail - only the fact that
  // an invitation was created, for whom, and for which department.
  await writeAuditLog({
    actorUserId: admin.id,
    action: "INVITATION_CREATED",
    entityType: "Invitation",
    entityId: invitation.id,
    afterData: { departmentId: department.id, departmentCode: department.code, email },
  });

  return {
    invitation: { id: invitation.id, departmentId: invitation.departmentId, email: invitation.email, expiresAt: invitation.expiresAt },
    token,
  };
}

export interface InvitationSummary {
  id: string;
  email: string;
  status: string;
  attemptCount: number;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  acceptedByUserId: string | null;
  department: { id: string; code: string; name: string };
  createdBy: { name: string; email: string };
  acceptedBy: { name: string; email: string } | null;
}

/** Admin-facing list. Deliberately selects every column EXCEPT tokenHash. */
export async function listInvitations(admin: CurrentUser): Promise<InvitationSummary[]> {
  await requireCapability(admin, "user.manage");

  const rows = await prisma.invitation.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      status: true,
      attemptCount: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      createdAt: true,
      acceptedByUserId: true,
      department: { select: { id: true, code: true, name: true } },
      createdBy: { select: { name: true, email: true } },
      acceptedBy: { select: { name: true, email: true } },
    },
  });
  return rows;
}

/** Revokes a not-yet-accepted (PENDING or LOCKED) invitation. Never applies to an already-ACCEPTED one - see revokeDepartmentAccess for that. */
export async function revokeInvitation(admin: CurrentUser, invitationId: string): Promise<void> {
  await requireCapability(admin, "user.manage");

  const invitation = await prisma.invitation.findUnique({ where: { id: invitationId } });
  if (!invitation) throw new ApiError(404, "找不到此邀請");
  if (invitation.status !== "PENDING" && invitation.status !== "LOCKED") {
    throw new ApiError(409, "此邀請目前狀態無法撤銷");
  }

  await prisma.invitation.update({
    where: { id: invitationId },
    data: { status: "REVOKED", revokedAt: new Date(), revokedById: admin.id },
  });

  await writeAuditLog({
    actorUserId: admin.id,
    action: "INVITATION_REVOKED",
    entityType: "Invitation",
    entityId: invitationId,
    beforeData: { status: invitation.status },
    afterData: { status: "REVOKED" },
  });
}

/**
 * Revokes an already-granted department authorization (a UserDepartmentScope
 * row) - the counterpart to revokeInvitation for access that has already
 * been accepted. Deleting the scope row takes effect on the user's very
 * next request (every route re-checks getAccessibleDepartmentIds live, none
 * of them cache it), independent of whether their session/cookie is still
 * otherwise valid.
 */
export async function revokeDepartmentAccess(admin: CurrentUser, userId: string, departmentId: string): Promise<void> {
  await requireCapability(admin, "user.manage");

  const scope = await prisma.userDepartmentScope.findUnique({
    where: { userId_departmentId: { userId, departmentId } },
  });
  if (!scope) throw new ApiError(404, "此使用者未擁有該部門的授權");

  await prisma.userDepartmentScope.delete({ where: { id: scope.id } });

  await writeAuditLog({
    actorUserId: admin.id,
    action: "DEPARTMENT_ACCESS_REVOKED",
    entityType: "UserDepartmentScope",
    entityId: scope.id,
    beforeData: { userId, departmentId },
  });
}

/**
 * Forces every existing session for this user to fail validation on its
 * very next request, by bumping User.sessionVersion (see that column's own
 * schema.prisma doc comment) - the only revocation mechanism available for
 * an otherwise-stateless JWT session cookie.
 */
export async function revokeAllSessions(admin: CurrentUser, userId: string): Promise<void> {
  await requireCapability(admin, "user.manage");

  const user = await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  });

  await writeAuditLog({
    actorUserId: admin.id,
    action: "ALL_SESSIONS_REVOKED",
    entityType: "User",
    entityId: userId,
    afterData: { sessionVersion: user.sessionVersion },
  });
}

export type AcceptInvitationFailureReason = "NOT_FOUND" | "EXPIRED" | "LOCKED" | "REVOKED" | "ALREADY_ACCEPTED" | "WRONG_TOKEN";

export class AcceptInvitationError extends ApiError {
  reason: AcceptInvitationFailureReason;
  constructor(status: number, message: string, reason: AcceptInvitationFailureReason) {
    super(status, message);
    this.reason = reason;
  }
}

export interface AcceptInvitationResult {
  userId: string;
  email: string;
  role: import("@prisma/client").Role;
  companyWide: boolean;
  sessionVersion: number;
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  isNewUser: boolean;
}

/**
 * Verifies a submitted plaintext token against the specific invitation
 * identified by `invitationId` (the only thing that ever appears in the
 * invitation URL/email - see the Invitation model's doc comment), and on
 * success grants department access (creating the User row if this is their
 * first ever accepted invitation) and marks the invitation consumed.
 *
 * Every branch below - success or failure - writes exactly one AuditLog
 * row, and none of them ever include the submitted or stored token value
 * (hashed or otherwise) in beforeData/afterData/reason.
 */
export async function acceptInvitation(params: {
  invitationId: string;
  token: string;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<AcceptInvitationResult> {
  const invitation = await prisma.invitation.findUnique({ where: { id: params.invitationId } });
  if (!invitation) {
    throw new AcceptInvitationError(404, "找不到此邀請，請確認連結是否正確", "NOT_FOUND");
  }

  if (invitation.status === "REVOKED") {
    throw new AcceptInvitationError(410, "此邀請已被管理者撤銷", "REVOKED");
  }
  if (invitation.status === "ACCEPTED") {
    throw new AcceptInvitationError(410, "此邀請已被使用過，Token 僅能使用一次", "ALREADY_ACCEPTED");
  }
  if (invitation.status === "LOCKED") {
    throw new AcceptInvitationError(423, "此邀請因多次輸入錯誤已被鎖定，請聯絡管理者重新發送邀請", "LOCKED");
  }
  if (invitation.status === "EXPIRED" || invitation.expiresAt.getTime() < Date.now()) {
    if (invitation.status !== "EXPIRED") {
      await prisma.invitation.update({ where: { id: invitation.id }, data: { status: "EXPIRED" } });
    }
    throw new AcceptInvitationError(410, "此邀請已超過 21 天有效期限，請聯絡管理者重新發送邀請", "EXPIRED");
  }

  const submittedHash = hashInvitationToken(params.token);
  const tokenMatches = crypto.timingSafeEqual(
    Buffer.from(submittedHash, "hex"),
    Buffer.from(invitation.tokenHash, "hex")
  );

  if (!tokenMatches) {
    const nextAttemptCount = invitation.attemptCount + 1;
    const lockedNow = nextAttemptCount >= MAX_INVITATION_ATTEMPTS;
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { attemptCount: nextAttemptCount, status: lockedNow ? "LOCKED" : "PENDING" },
    });
    await writeAuditLog({
      actorUserId: null,
      action: lockedNow ? "INVITATION_LOCKED" : "INVITATION_TOKEN_MISMATCH",
      entityType: "Invitation",
      entityId: invitation.id,
      afterData: { attemptCount: nextAttemptCount, ipAddress: params.ipAddress },
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    });
    if (lockedNow) {
      throw new AcceptInvitationError(423, "驗證碼錯誤次數已達上限，此邀請已被鎖定，請聯絡管理者重新發送邀請", "LOCKED");
    }
    const remaining = MAX_INVITATION_ATTEMPTS - nextAttemptCount;
    throw new AcceptInvitationError(422, `驗證碼錯誤，您還有 ${remaining} 次嘗試機會`, "WRONG_TOKEN");
  }

  const department = await prisma.department.findUniqueOrThrow({ where: { id: invitation.departmentId } });

  const result = await prisma.$transaction(async (tx) => {
    let user = await tx.user.findUnique({ where: { email: invitation.email } });
    let isNewUser = false;
    if (!user) {
      isNewUser = true;
      // This flow is passwordless-by-design (identity is established by
      // possessing the invitation token, not a password) - a random,
      // never-revealed password is still stored because User.passwordHash
      // is NOT NULL, so the existing password-based /login route simply
      // has no usable credential for this account until/unless an admin
      // separately issues one via the password-reset flow.
      const unusablePassword = crypto.randomBytes(32).toString("base64url");
      user = await tx.user.create({
        data: {
          email: invitation.email,
          passwordHash: await hashPassword(unusablePassword),
          name: invitation.email.split("@")[0] ?? invitation.email,
          role: "BUDGET_OWNER",
          companyWide: false,
        },
      });
    }

    await tx.userDepartmentScope.upsert({
      where: { userId_departmentId: { userId: user.id, departmentId: department.id } },
      create: { userId: user.id, departmentId: department.id },
      update: {},
    });

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedByUserId: user.id },
    });

    await writeAuditLog(
      {
        actorUserId: user.id,
        action: "INVITATION_ACCEPTED",
        entityType: "Invitation",
        entityId: invitation.id,
        afterData: { departmentId: department.id, departmentCode: department.code, email: invitation.email, isNewUser },
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
      tx
    );
    await writeAuditLog(
      {
        actorUserId: user.id,
        action: "LOGIN_SUCCESS",
        entityType: "User",
        entityId: user.id,
        reason: "邀請驗證登入",
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
      tx
    );

    return { user, isNewUser };
  });

  return {
    userId: result.user.id,
    email: result.user.email,
    role: result.user.role,
    companyWide: result.user.companyWide,
    sessionVersion: result.user.sessionVersion,
    departmentId: department.id,
    departmentCode: department.code,
    departmentName: department.name,
    isNewUser: result.isNewUser,
  };
}
