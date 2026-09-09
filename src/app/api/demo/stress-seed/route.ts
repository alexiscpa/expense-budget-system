import { NextResponse } from "next/server";
import { requireUser, requireCapability, errorResponse } from "@/lib/rbac/guard";
import { assertSameOrigin } from "@/lib/security/csrf";
import { isPreviewStressSeedEnvironment } from "@/lib/env";
import { runStage2ATestSeed } from "@/lib/testdata/stage2aSeed";

/**
 * Preview-only Stage 2A test data initializer. See src/lib/testdata/
 * stage2aSeed.ts for what it creates. Hard environment gate first (never
 * production, regardless of who is calling or what role they hold), then
 * normal auth + RBAC so the AuditLog entry has a real actor. Idempotent:
 * calling this repeatedly never creates duplicate rows and never touches
 * anything outside the 8 named test departments.
 */
export async function POST(request: Request) {
  try {
    if (!isPreviewStressSeedEnvironment()) {
      return NextResponse.json(
        { error: "此功能僅限 Preview 測試環境使用，正式環境一律拒絕" },
        { status: 403 }
      );
    }

    assertSameOrigin(request);
    const user = await requireUser();
    await requireCapability(user, "testdata.stage2a_seed");

    const result = await runStage2ATestSeed(user);
    return NextResponse.json({ result });
  } catch (err) {
    return errorResponse(err);
  }
}
