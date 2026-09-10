import { NextResponse } from "next/server";
import { requireUser, requireDepartmentAccess, errorResponse } from "@/lib/rbac/guard";
import { switchActiveDepartmentSchema } from "@/lib/validation/schemas";
import { assertSameOrigin, clientIp } from "@/lib/security/csrf";
import { writeAuditLog } from "@/lib/audit/log";
import { prisma } from "@/lib/prisma";
import { ACTIVE_DEPARTMENT_COOKIE } from "@/lib/session/activeDepartmentCookie";

/**
 * "多部門切換" (Stage 2B-3 三部門邀請登入 Pilot) - a display-only
 * preference, never itself a source of authorization: every real data
 * route still independently calls requireDepartmentAccess/
 * getAccessibleDepartmentIds on every request regardless of this cookie's
 * value, so tampering with it client-side can at most change which
 * department the dashboard highlights as "current" - it can never grant
 * access to a department the caller isn't actually scoped to. The
 * requireDepartmentAccess call below exists so a switch attempt into a
 * department the user has no scope on is rejected (403) and audited,
 * rather than silently accepted.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = await request.json();
    const parsed = switchActiveDepartmentSchema.parse(body);

    await requireDepartmentAccess(user, parsed.departmentId);
    const department = await prisma.department.findUniqueOrThrow({ where: { id: parsed.departmentId } });

    await writeAuditLog({
      actorUserId: user.id,
      action: "DEPARTMENT_SWITCHED",
      entityType: "Department",
      entityId: department.id,
      afterData: { departmentCode: department.code },
      ipAddress: clientIp(request),
    });

    const response = NextResponse.json({ department: { id: department.id, code: department.code, name: department.name } });
    response.cookies.set(ACTIVE_DEPARTMENT_COOKIE, department.id, {
      httpOnly: false,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (err) {
    return errorResponse(err);
  }
}
