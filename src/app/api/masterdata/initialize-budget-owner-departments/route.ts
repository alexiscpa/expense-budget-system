import { NextResponse } from "next/server";
import { requireUser, requireCapability, errorResponse, ApiError } from "@/lib/rbac/guard";
import { assertSameOrigin } from "@/lib/security/csrf";
import { isVercelProductionEnvironment } from "@/lib/env";
import { initializeBudgetOwnerDepartments } from "@/lib/masterdata/initializeBudgetOwnerDepartments";
import { BUDGET_OWNER_ROSTER } from "@/lib/masterdata/budgetOwnerRoster";

/**
 * Creates any missing Department rows for the 45-department Stage 2B-2
 * roster. Hard-blocked in Production (see isVercelProductionEnvironment);
 * everywhere else (Preview, local dev) requires an explicit `{confirm:
 * true}` body so this can never be triggered by an accidental click or a
 * bare GET/health-check-style request - see docs/stage2b1-final-budget-
 * owner-list.md and docs/data/stage2b1-department-manifest.json for the
 * roster's authoritative source.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    if (isVercelProductionEnvironment()) {
      throw new ApiError(403, "此功能禁止在 Production 環境執行，部門主檔須以審慎流程另行匯入");
    }
    const user = await requireUser();
    await requireCapability(user, "master_data.import");

    const body = await request.json().catch(() => ({}));
    if (body?.confirm !== true) {
      throw new ApiError(400, "此操作會建立正式部門主檔，請於請求中明確帶上 confirm: true 以確認執行");
    }

    const result = await initializeBudgetOwnerDepartments(user);
    return NextResponse.json({ result }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** Read-only status check - never mutates, safe to call from any environment. */
export async function GET() {
  try {
    const user = await requireUser();
    await requireCapability(user, "master_data.import");
    const { prisma } = await import("@/lib/prisma");
    const codes = BUDGET_OWNER_ROSTER.map((r) => r.code);
    const existing = await prisma.department.findMany({
      where: { code: { in: codes } },
      select: { code: true, isActive: true },
    });
    const existingCodes = new Set(existing.map((d) => d.code));
    return NextResponse.json({
      rosterSize: BUDGET_OWNER_ROSTER.length,
      existingCount: existing.length,
      missingCodes: codes.filter((c) => !existingCodes.has(c)),
      inactiveExistingCodes: existing.filter((d) => !d.isActive).map((d) => d.code),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
