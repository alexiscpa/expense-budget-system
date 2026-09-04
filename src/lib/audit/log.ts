import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";

export interface AuditEntry {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  reason?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Append-only audit trail writer. There is deliberately no update/delete
 * counterpart exposed anywhere in the codebase - audit rows must never be
 * editable, including by SYSTEM_ADMIN, per the internal-control requirements.
 */
export async function writeAuditLog(entry: AuditEntry, tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;
  await client.auditLog.create({
    data: {
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      reason: entry.reason ?? null,
      beforeData: toJson(entry.beforeData),
      afterData: toJson(entry.afterData),
      ipAddress: entry.ipAddress ?? null,
      userAgent: entry.userAgent ?? null,
    },
  });
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  // Decimal / Date values must be serialized explicitly so JSON.stringify
  // doesn't silently drop precision or throw on circular structures.
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === "object" && v !== null && "toFixed" in v ? v.toString() : v))
  ) as Prisma.InputJsonValue;
}
