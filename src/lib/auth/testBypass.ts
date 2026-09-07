import type { Role } from "@prisma/client";
import type { CurrentUser } from "@/lib/auth/session";

/**
 * Sentinel id for the virtual "test admin" identity used only when
 * AUTH_DISABLED bypass mode is active (see lib/env.ts#isAuthBypassEnabled).
 *
 * This id deliberately never corresponds to a row in the User table:
 *  - getCurrentUser() returns this identity directly, without any database
 *    lookup - no default password or seed user is ever created for it.
 *  - writeAuditLog() recognizes this sentinel and strips it back out to
 *    NULL + an explicit TEST_BYPASS_USER marker before the row is written,
 *    so it can never collide with, or be mistaken for, a real user id in
 *    the audit trail.
 *
 * Any action that requires writing a *real* user id into a foreign key
 * (e.g. BudgetVersion.preparedById) will fail with a database constraint
 * error when performed as this identity. That is intentional: it is safer
 * for those actions to fail loudly than to fabricate a database user just
 * so bypass mode can impersonate one.
 */
export const TEST_BYPASS_USER_ID = "TEST_BYPASS_USER";

/** Display name shown in the UI so this identity is never mistaken for a real person. */
export const TEST_BYPASS_USER_NAME = "測試管理員（Demo 測試環境）";

export function testBypassUser(): CurrentUser {
  return {
    id: TEST_BYPASS_USER_ID,
    email: "test-bypass@local.invalid",
    name: TEST_BYPASS_USER_NAME,
    role: "SYSTEM_ADMIN" as Role,
    companyWide: true,
    isActive: true,
  };
}

export function isTestBypassUser(user: { id: string } | null | undefined): boolean {
  return user?.id === TEST_BYPASS_USER_ID;
}
