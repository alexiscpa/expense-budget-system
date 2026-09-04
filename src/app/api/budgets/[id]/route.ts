import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser, requireDepartmentAccess, ApiError, errorResponse } from "@/lib/rbac/guard";
import { canViewSalaryDetail } from "@/lib/rbac/permissions";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const user = await requireUser();
    const version = await prisma.budgetVersion.findUnique({
      where: { id: params.id },
      include: {
        department: true,
        lines: { include: { account: true }, orderBy: { account: { code: "asc" } } },
      },
    });
    if (!version) throw new ApiError(404, "找不到此預算版本");
    await requireDepartmentAccess(user, version.departmentId);

    // Salary-derived FORMULA amounts are shown, but the underlying payroll
    // breakdown is never exposed to a department-scoped viewer.
    const canSeeSalary = canViewSalaryDetail(user.role);

    return NextResponse.json({
      version: {
        ...version,
        lines: version.lines.map((line) => ({
          ...line,
          salaryDetailRestricted: line.entryTypeSnapshot === "FORMULA" && !canSeeSalary,
        })),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
