import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, errorResponse } from "@/lib/rbac/guard";
import { getAccessibleDepartmentIds } from "@/lib/rbac/permissions";
import { createBudgetVersionDraft } from "@/lib/budget/lineService";
import { createDraftSchema } from "@/lib/validation/schemas";
import { assertSameOrigin } from "@/lib/security/csrf";

export async function GET(request: Request) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const fiscalYear = searchParams.get("fiscalYear");

    const accessibleDepartmentIds = await getAccessibleDepartmentIds(user);

    const versions = await prisma.budgetVersion.findMany({
      where: {
        fiscalYear: fiscalYear ? Number(fiscalYear) : undefined,
        departmentId: accessibleDepartmentIds === null ? undefined : { in: accessibleDepartmentIds },
      },
      include: { department: true },
      orderBy: [{ fiscalYear: "desc" }, { departmentId: "asc" }, { versionNumber: "desc" }],
      take: 200,
    });

    return NextResponse.json({ versions });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const body = await request.json();
    const parsed = createDraftSchema.parse(body);
    const version = await createBudgetVersionDraft(user, parsed.departmentId, parsed.fiscalYear);
    return NextResponse.json({ version }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
