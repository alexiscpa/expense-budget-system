import { prisma } from "@/lib/prisma";
import { TEST_BYPASS_USER_ID } from "@/lib/auth/testBypass";
import type { Prisma } from "@prisma/client";

const TEST_BYPASS_MARKER = "[TEST_BYPASS_USER]";

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
  // The virtual test-bypass identity (see lib/auth/testBypass.ts) has no row
  // in the User table, so its sentinel id must never be written into the
  // actorUserId foreign key - that would either violate the FK constraint or,
  // worse, silently collide with a real user id if one were ever reused.
  // Instead: actorUserId is forced to NULL and an unambiguous marker is
  // stamped into `reason`, so bypass-mode actions are always distinguishable
  // from - and can never impersonate - a real person in the audit trail.
  const isBypassActor = entry.actorUserId === TEST_BYPASS_USER_ID;
  await client.auditLog.create({
    data: {
      actorUserId: isBypassActor ? null : entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      reason: isBypassActor
        ? [TEST_BYPASS_MARKER, entry.reason].filter(Boolean).join(" ")
        : entry.reason ?? null,
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
