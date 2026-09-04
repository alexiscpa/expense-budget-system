import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireCapability, errorResponse } from "@/lib/rbac/guard";

/**
 * Read-only. There is deliberately no PATCH/PUT/DELETE handler anywhere in
 * this route tree for AuditLog - it cannot be modified or removed by any
 * role, including SYSTEM_ADMIN, through the API.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser();
    await requireCapability(user, "audit.view");

    const { searchParams } = new URL(request.url);
    const entityType = searchParams.get("entityType") ?? undefined;
    const entityId = searchParams.get("entityId") ?? undefined;

    const logs = await prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return NextResponse.json({ logs });
  } catch (err) {
    return errorResponse(err);
  }
}
