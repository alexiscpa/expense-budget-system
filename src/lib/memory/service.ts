import { prisma } from "@/lib/prisma";
import type { MemoryType } from "@prisma/client";
import type { CurrentUser } from "@/lib/auth/session";
import { requireDepartmentAccess, ApiError } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/log";

// Memory types that represent business/audit records - source, timestamp,
// author and scope are all mandatory (enforced by the Prisma schema being
// non-nullable) and these are never user-deletable, per docs instruction §三.
const AUDIT_REQUIRED_TYPES: MemoryType[] = [
  "PRIOR_YEAR_APPROVED_BUDGET",
  "PRIOR_YEAR_ACTUAL",
  "SUBMISSION_VERSION",
  "RETURN_REASON",
  "MANUAL_ADJUSTMENT",
  "PERIOD_VARIANCE",
  "AMOUNT_PERCENT_VARIANCE",
];

// Only these personal-preference types may be cleared by their owner.
const USER_DELETABLE_TYPES: MemoryType[] = ["QUERY_PREFERENCE", "FIELD_PREFERENCE", "USER_DRAFT"];

export interface CreateMemoryInput {
  type: MemoryType;
  scopeDepartmentId: string | null;
  fiscalYear: number | null;
  source: string;
  payload: unknown;
  aiSuggested?: boolean;
}

export async function createMemoryEntry(user: CurrentUser, input: CreateMemoryInput) {
  if (input.scopeDepartmentId) {
    await requireDepartmentAccess(user, input.scopeDepartmentId);
  } else if (!user.companyWide) {
    // Department-scoped roles may never write a company-wide (null-scope)
    // memory entry - that would let a departmental user's "preference"
    // leak into a scope they cannot see.
    throw new ApiError(403, "您沒有權限建立公司層級的記憶紀錄");
  }

  const isUserDeletable = USER_DELETABLE_TYPES.includes(input.type) && !AUDIT_REQUIRED_TYPES.includes(input.type);

  const entry = await prisma.memoryEntry.create({
    data: {
      type: input.type,
      scopeDepartmentId: input.scopeDepartmentId,
      fiscalYear: input.fiscalYear,
      source: input.source,
      payload: input.payload as never,
      createdById: user.id,
      isUserDeletable,
      aiSuggested: input.aiSuggested ?? false,
    },
  });

  await writeAuditLog({
    actorUserId: user.id,
    action: "MEMORY_CREATED",
    entityType: "MemoryEntry",
    entityId: entry.id,
    afterData: { type: entry.type, scopeDepartmentId: entry.scopeDepartmentId, fiscalYear: entry.fiscalYear },
  });

  return entry;
}

/**
 * Confirms an AI-suggested memory entry as human-reviewed. Per docs
 * instruction §三.6, an AI suggestion must be clearly labeled and may only
 * be treated as authoritative draft input after a human explicitly confirms
 * it here - nothing in this codebase writes AI output straight into a
 * BudgetLine.
 */
export async function confirmAiSuggestion(user: CurrentUser, memoryId: string) {
  const entry = await prisma.memoryEntry.findUnique({ where: { id: memoryId } });
  if (!entry) throw new ApiError(404, "找不到此建議紀錄");
  if (entry.scopeDepartmentId) await requireDepartmentAccess(user, entry.scopeDepartmentId);
  if (!entry.aiSuggested) throw new ApiError(422, "此紀錄非 AI 建議，無需確認");

  const updated = await prisma.memoryEntry.update({
    where: { id: memoryId },
    data: { aiConfirmedById: user.id, aiConfirmedAt: new Date() },
  });

  await writeAuditLog({
    actorUserId: user.id,
    action: "AI_SUGGESTION_CONFIRMED",
    entityType: "MemoryEntry",
    entityId: memoryId,
  });

  return updated;
}

export async function overrideAiSuggestion(user: CurrentUser, memoryId: string, reason: string) {
  if (!reason || reason.trim().length === 0) {
    throw new ApiError(422, "人工覆寫系統建議時必須填寫理由");
  }
  const entry = await prisma.memoryEntry.findUnique({ where: { id: memoryId } });
  if (!entry) throw new ApiError(404, "找不到此建議紀錄");
  if (entry.scopeDepartmentId) await requireDepartmentAccess(user, entry.scopeDepartmentId);

  const updated = await prisma.memoryEntry.update({
    where: { id: memoryId },
    data: { overrideReason: reason },
  });

  await writeAuditLog({
    actorUserId: user.id,
    action: "AI_SUGGESTION_OVERRIDDEN",
    entityType: "MemoryEntry",
    entityId: memoryId,
    reason,
  });

  return updated;
}

export interface ListMemoryFilter {
  type?: MemoryType;
  scopeDepartmentId?: string;
  fiscalYear?: number;
}

export async function listMemoryEntries(user: CurrentUser, filter: ListMemoryFilter) {
  if (filter.scopeDepartmentId) {
    await requireDepartmentAccess(user, filter.scopeDepartmentId);
  }

  const accessibleDepartmentIds = user.companyWide
    ? null
    : (await prisma.userDepartmentScope.findMany({ where: { userId: user.id }, select: { departmentId: true } })).map(
        (s) => s.departmentId
      );

  return prisma.memoryEntry.findMany({
    where: {
      deletedAt: null,
      type: filter.type,
      fiscalYear: filter.fiscalYear,
      ...(filter.scopeDepartmentId
        ? { scopeDepartmentId: filter.scopeDepartmentId }
        : accessibleDepartmentIds === null
          ? {}
          : { OR: [{ scopeDepartmentId: { in: accessibleDepartmentIds } }, { scopeDepartmentId: null }] }),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

/**
 * A user may clear their own personal preference memories, but never
 * audit-required business records (approved budgets, return reasons,
 * submission history, manual adjustments) - those are retained per legal /
 * internal-control record-keeping requirements regardless of who asks.
 */
export async function deleteOwnMemoryEntry(user: CurrentUser, memoryId: string) {
  const entry = await prisma.memoryEntry.findUnique({ where: { id: memoryId } });
  if (!entry) throw new ApiError(404, "找不到此紀錄");
  if (entry.createdById !== user.id) throw new ApiError(403, "只能清除自己建立的個人偏好紀錄");
  if (!entry.isUserDeletable) {
    throw new ApiError(403, "此紀錄屬於稽核／內控保留紀錄，不可刪除");
  }

  await prisma.memoryEntry.update({ where: { id: memoryId }, data: { deletedAt: new Date() } });

  await writeAuditLog({
    actorUserId: user.id,
    action: "MEMORY_USER_DELETED",
    entityType: "MemoryEntry",
    entityId: memoryId,
  });
}
