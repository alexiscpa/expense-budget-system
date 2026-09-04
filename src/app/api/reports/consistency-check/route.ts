import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireCapability, errorResponse } from "@/lib/rbac/guard";
import { runConsistencyCheck } from "@/lib/reports/consistencyCheck";
import { assertSameOrigin } from "@/lib/security/csrf";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    await requireCapability(user, "report.view");
    const { searchParams } = new URL(request.url);
    const fiscalYear = Number(searchParams.get("fiscalYear"));
    const latest = await prisma.consistencyCheckRun.findFirst({
      where: { fiscalYear },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ run: latest });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await requireCapability(user, "report.view");
    const body = await request.json();
    const fiscalYear = Number(body.fiscalYear);
    const run = await runConsistencyCheck(user, fiscalYear);
    return NextResponse.json({ run });
  } catch (err) {
    return errorResponse(err);
  }
}
