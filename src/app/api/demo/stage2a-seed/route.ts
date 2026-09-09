import { NextResponse } from "next/server";
import { requireUser, errorResponse, ApiError } from "@/lib/rbac/guard";
import { assertSameOrigin } from "@/lib/security/csrf";
import { isAuthBypassEnabled } from "@/lib/env";
import { runStage2ATestSeed, getStage2ASeedStatus } from "@/lib/testdata/stage2aSeed";

/**
 * Preview-only endpoint: creates (or confirms) the Stage 2A 8-department
 * test data. Gated on isAuthBypassEnabled() before anything else runs,
 * exactly like /api/demo/seed - unreachable in Production or any
 * non-Preview environment regardless of who is (or isn't) logged in.
 */
export async function GET() {
  try {
    if (!isAuthBypassEnabled()) {
      throw new ApiError(403, "此功能僅限 Vercel Preview 測試環境（AUTH_DISABLED=true）使用");
    }
    await requireUser();
    const status = await getStage2ASeedStatus();
    return NextResponse.json({ status });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (!isAuthBypassEnabled()) {
      throw new ApiError(403, "此功能僅限 Vercel Preview 測試環境（AUTH_DISABLED=true）使用");
    }
    const user = await requireUser();
    const result = await runStage2ATestSeed(user);
    return NextResponse.json({ result }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
