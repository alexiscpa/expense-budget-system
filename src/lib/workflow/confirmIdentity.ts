import type { CurrentUser } from "@/lib/auth/session";
import { ApiError } from "@/lib/rbac/guard";

/**
 * 「預算送出前須再次確認目前登入身分」(Stage 2B-3 三部門邀請登入 Pilot) -
 * the caller must echo back the email they believe they are currently
 * logged in as (see BudgetVersionClient.tsx's confirmingSubmit UI step,
 * which shows the real session email and requires an explicit click before
 * this is ever called); a mismatch is rejected outright rather than
 * silently proceeding. Deliberately a small, pure, directly-testable
 * function - the submit/resubmit API routes call it before invoking
 * submitBudgetVersion/resubmitBudgetVersion, which are otherwise completely
 * unaware of this requirement (see those routes' own doc comments for why
 * the check lives at the route boundary, not inside the workflow service
 * functions themselves).
 */
export function assertIdentityConfirmed(user: CurrentUser, confirmedEmail: string): void {
  if (confirmedEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
    throw new ApiError(422, "請再次確認您目前登入的帳號後再送出");
  }
}
