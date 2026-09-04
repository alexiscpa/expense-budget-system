import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkHealth } from "@/lib/health/check";

export const dynamic = "force-dynamic";

/**
 * Liveness + Neon connectivity check. Never exposes stack traces or
 * database error text (only a generic status), so it is safe to leave
 * publicly reachable for uptime monitors.
 */
export async function GET() {
  const result = await checkHealth(prisma);
  return NextResponse.json(result, { status: result.database === "ok" ? 200 : 503 });
}
