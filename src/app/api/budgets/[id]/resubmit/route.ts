import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/rbac/guard";
import { resubmitBudgetVersion } from "@/lib/workflow/actions";
import { assertIdentityConfirmed } from "@/lib/workflow/confirmIdentity";
import { submitBudgetSchema } from "@/lib/validation/schemas";
import { assertSameOrigin } from "@/lib/security/csrf";
import { writeAuditLog } from "@/lib/audit/log";

// See submit/route.ts's own doc comment - same route-level identity
// reconfirmation, same reason it lives here rather than inside
// resubmitBudgetVersion().
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

    const version = await resubmitBudgetVersion(user, params.id);
    return NextResponse.json({ version });
  } catch (err) {
    return errorResponse(err);
  }
}
