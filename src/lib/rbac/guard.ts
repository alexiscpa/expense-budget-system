import { NextResponse } from "next/server";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { hasCapability, canAccessDepartment } from "@/lib/rbac/permissions";
import { writeAuditLog } from "@/lib/audit/log";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new ApiError(401, "請先登入");
  return user;
}

export async function requireCapability(user: CurrentUser, capability: string): Promise<void> {
  if (!hasCapability(user.role, capability)) {
    await writeAuditLog({
      actorUserId: user.id,
      action: "ACCESS_DENIED",
      entityType: "capability",
      entityId: capability,
    });
    throw new ApiError(403, "您沒有權限執行此操作");
  }
}

/**
 * Enforces department scoping server-side. Never trust a departmentId that
 * arrives as a request parameter/body without running it through this check
 * - that is exactly the IDOR pattern this system must prevent.
 */
export async function requireDepartmentAccess(user: CurrentUser, departmentId: string): Promise<void> {
  const allowed = await canAccessDepartment(user, departmentId);
  if (!allowed) {
    await writeAuditLog({
      actorUserId: user.id,
      action: "ACCESS_DENIED_CROSS_DEPARTMENT",
      entityType: "department",
      entityId: departmentId,
    });
    throw new ApiError(403, "您沒有權限查看此部門的資料，如需查看請聯絡財務單位");
  }
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  // Never leak stack traces / DB error text to the client in any environment.
  // eslint-disable-next-line no-console
  console.error(err);
  return NextResponse.json({ error: "系統發生錯誤，請稍後再試" }, { status: 500 });
}
