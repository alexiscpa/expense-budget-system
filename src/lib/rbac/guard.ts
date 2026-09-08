import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getCurrentUser, type CurrentUser } from "@/lib/auth/session";
import { hasCapability, canAccessDepartment } from "@/lib/rbac/permissions";
import { writeAuditLog } from "@/lib/audit/log";
import { isTestBypassUser } from "@/lib/auth/testBypass";

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

/**
 * Extra capabilities granted only to the virtual TEST_BYPASS_USER identity,
 * on top of whatever its role (SYSTEM_ADMIN) already grants. This exists so
 * the Preview-only demo admin can create and submit a test budget draft
 * through the screen. Deliberately does NOT include review/approve/return/
 * reject/adjustment capabilities - those segregation-of-duties controls stay
 * exactly as designed for every identity, bypass included. Since a
 * TEST_BYPASS_USER identity can only ever be the current user when the
 * fail-closed, Preview-only gate in lib/env.ts lets it through, this never
 * affects Production or any real user's permissions.
 */
const TEST_BYPASS_EXTRA_CAPABILITIES = new Set(["budget.edit_own_department", "budget.submit_own_department"]);

export async function requireCapability(user: CurrentUser, capability: string): Promise<void> {
  const allowed =
    hasCapability(user.role, capability) || (isTestBypassUser(user) && TEST_BYPASS_EXTRA_CAPABILITIES.has(capability));
  if (!allowed) {
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
  if (err instanceof ZodError) {
    // zod schemas in this codebase always carry a Traditional-Chinese
    // message per field (see lib/validation/schemas.ts) - surface the
    // first one directly instead of masking every malformed request behind
    // the generic 500 below. Never includes the raw field path or zod's
    // own internal error shape, only the human-readable message we wrote.
    const message = err.issues[0]?.message ?? "輸入資料格式錯誤";
    return NextResponse.json({ error: message }, { status: 422 });
  }
  // Never leak stack traces / DB error text to the client in any environment.
  // eslint-disable-next-line no-console
  console.error(err);
  return NextResponse.json({ error: "系統發生錯誤，請稍後再試" }, { status: 500 });
}
