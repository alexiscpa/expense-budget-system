import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "@/lib/auth/session";
import { requireCapability, ApiError } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/log";
import type { DualControlAction, Role } from "@prisma/client";

export async function createDualControlRequest(
  user: CurrentUser,
  input: { action: DualControlAction; targetEntityType: string; targetEntityId: string; reason: string; payload?: unknown }
) {
  await requireCapability(user, "dual_control.approve"); // only roles that could eventually approve may initiate

  const request = await prisma.dualControlRequest.create({
    data: {
      action: input.action,
      targetEntityType: input.targetEntityType,
      targetEntityId: input.targetEntityId,
      reason: input.reason,
      payload: input.payload as never,
      requestedById: user.id,
    },
  });

  await writeAuditLog({
    actorUserId: user.id,
    action: "DUAL_CONTROL_REQUESTED",
    entityType: "DualControlRequest",
    entityId: request.id,
    reason: input.reason,
    afterData: { action: input.action, targetEntityId: input.targetEntityId },
  });

  return request;
}

/**
 * Second-person approval. The approver must be a different person than the
 * requester (high-risk operations §四). For ROLE_CHANGE requests, approval
 * atomically applies the role change - there is no separate "apply" step
 * that could be skipped or run twice.
 */
export async function approveDualControlRequest(user: CurrentUser, requestId: string) {
  await requireCapability(user, "dual_control.approve");

  return prisma.$transaction(async (tx) => {
    const request = await tx.dualControlRequest.findUnique({ where: { id: requestId } });
    if (!request) throw new ApiError(404, "找不到此覆核申請");
    if (request.status !== "PENDING") throw new ApiError(409, "此申請已被處理");
    if (request.requestedById === user.id) {
      throw new ApiError(403, "申請人與核准人不得為同一人");
    }

    const updated = await tx.dualControlRequest.update({
      where: { id: requestId },
      data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() },
    });

    if (request.action === "ROLE_CHANGE") {
      const payload = request.payload as { newRole?: Role } | null;
      if (!payload?.newRole) throw new ApiError(422, "缺少角色變更內容");

      const before = await tx.user.findUnique({ where: { id: request.targetEntityId } });
      await tx.user.update({ where: { id: request.targetEntityId }, data: { role: payload.newRole } });
      await tx.dualControlRequest.update({ where: { id: requestId }, data: { consumedAt: new Date() } });

      await writeAuditLog(
        {
          actorUserId: user.id,
          action: "ROLE_CHANGED",
          entityType: "User",
          entityId: request.targetEntityId,
          reason: request.reason,
          beforeData: { role: before?.role },
          afterData: { role: payload.newRole },
        },
        tx
      );
    }

    await writeAuditLog(
      {
        actorUserId: user.id,
        action: "DUAL_CONTROL_APPROVED",
        entityType: "DualControlRequest",
        entityId: requestId,
      },
      tx
    );

    return updated;
  });
}

export async function rejectDualControlRequest(user: CurrentUser, requestId: string, reason: string) {
  await requireCapability(user, "dual_control.approve");
  const request = await prisma.dualControlRequest.findUnique({ where: { id: requestId } });
  if (!request) throw new ApiError(404, "找不到此覆核申請");
  if (request.status !== "PENDING") throw new ApiError(409, "此申請已被處理");
  if (request.requestedById === user.id) throw new ApiError(403, "申請人與核准人不得為同一人");

  const updated = await prisma.dualControlRequest.update({
    where: { id: requestId },
    data: { status: "REJECTED", approvedById: user.id, approvedAt: new Date() },
  });

  await writeAuditLog({
    actorUserId: user.id,
    action: "DUAL_CONTROL_REJECTED",
    entityType: "DualControlRequest",
    entityId: requestId,
    reason,
  });

  return updated;
}
