import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/rbac/guard";
import { submitBudgetVersion } from "@/lib/workflow/actions";
import { assertIdentityConfirmed } from "@/lib/workflow/confirmIdentity";
import { submitBudgetSchema } from "@/lib/validation/schemas";
import { assertSameOrigin } from "@/lib/security/csrf";
import { writeAuditLog } from "@/lib/audit/log";

/**
 * Requirement 「預算送出前須再次確認目前登入身分」 (Stage 2B-3 三部門邀請登入
 * Pilot) - enforced here at the route boundary rather than inside
 * submitBudgetVersion() itself, the same layering this codebase already
 * uses for assertSameOrigin (CSRF is also a route-level, not a
 * service-level, concern) - so the dozens of existing tests that call
 * submitBudgetVersion(user, versionId) directly to exercise the workflow
 * state machine are completely unaffected; only requests through this real
 * HTTP endpoint must supply and match confirmedEmail.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = await request.json();
    const parsed = submitBudgetSchema.parse(body);
    try {
      assertIdentityConfirmed(user, parsed.confirmedEmail);
    } catch (err) {
      await writeAuditLog({
        actorUserId: user.id,
        action: "SUBMIT_IDENTITY_CONFIRMATION_MISMATCH",
        entityType: "BudgetVersion",
        entityId: params.id,
      });
      throw err;
    }

    const version = await submitBudgetVersion(user, params.id);
    return NextResponse.json({ version });
  } catch (err) {
    return errorResponse(err);
  }
}
