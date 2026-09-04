import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireCapability, errorResponse } from "@/lib/rbac/guard";
import { createDualControlRequest } from "@/lib/security/dualControl";
import { dualControlRequestSchema } from "@/lib/validation/schemas";
import { assertSameOrigin } from "@/lib/security/csrf";

export async function GET() {
  try {
    const user = await requireUser();
    await requireCapability(user, "dual_control.approve");
    const requests = await prisma.dualControlRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ requests });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = await request.json();
    const parsed = dualControlRequestSchema.parse(body);
    const created = await createDualControlRequest(user, {
      action: parsed.action,
      targetEntityType: parsed.targetEntityType,
      targetEntityId: parsed.targetEntityId,
      reason: parsed.reason,
      payload: body.payload,
    });
    return NextResponse.json({ request: created }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
