import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { canAccessDepartment, canViewSalaryDetail } from "@/lib/rbac/permissions";
import { BudgetVersionClient } from "./BudgetVersionClient";

export const dynamic = "force-dynamic";

export default async function BudgetVersionPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const version = await prisma.budgetVersion.findUnique({
    where: { id: params.id },
    include: {
      department: true,
      // Account.code alone can no longer be sorted lexicographically into
      // spreadsheet order now that it holds the plain Excel A欄 序號 (e.g.
      // "3".."67", not the old zero-padded "FIN-003".."FIN-067") - a plain
      // string sort would put "10" before "3". sourceSeq (numeric, set for
      // every Excel-sourced account) restores the real 序號 order; accounts
      // without a sourceSeq (a normal, non-Excel-imported account) fall
      // back to sorting by code.
      lines: {
        include: { account: true },
        orderBy: [{ account: { sourceSeq: { sort: "asc", nulls: "last" } } }, { account: { code: "asc" } }],
      },
    },
  });
  if (!version) notFound();

  const allowed = await canAccessDepartment(user, version.departmentId);
  if (!allowed) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-10">
        <p className="text-red-600">您沒有權限查看此部門的資料，如需查看請聯絡財務單位</p>
      </main>
    );
  }

  const canSeeSalary = canViewSalaryDetail(user.role);

  return (
    <BudgetVersionClient
      currentUser={{ id: user.id, role: user.role, companyWide: user.companyWide }}
      version={JSON.parse(
        JSON.stringify(version, (_k, v) => (typeof v === "object" && v !== null && "toFixed" in v ? v.toString() : v))
      )}
      canSeeSalary={canSeeSalary}
    />
  );
}
