import { NextResponse } from "next/server";
import { requireUser, errorResponse } from "@/lib/rbac/guard";
import { approveBudgetVersion } from "@/lib/workflow/actions";
import { assertSameOrigin } from "@/lib/security/csrf";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const version = await approveBudgetVersion(user, params.id);
    return NextResponse.json({ version });
  } catch (err) {
    return errorResponse(err);
  }
}
