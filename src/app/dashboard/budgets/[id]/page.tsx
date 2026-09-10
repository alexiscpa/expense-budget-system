import { redirect, notFound } from "next/navigation";
import Link from "next/link";
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
    // The shared DashboardNav bar (dashboard/layout.tsx) already renders a
    // "← 回到預算總覽" button above this - this in-content link is a second,
    // more visible way to the same place for a reader who lands squarely on
    // this message.
    return (
      <main className="mx-auto max-w-2xl px-6 py-10">
        <p className="mb-4 text-red-600">您沒有權限查看此部門的資料，如需查看請聯絡財務單位</p>
        <Link href="/dashboard" className="rounded bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700">
          ← 回到預算總覽
        </Link>
      </main>
    );
  }

  const canSeeSalary = canViewSalaryDetail(user.role);

  return (
    <BudgetVersionClient
      currentUser={{ id: user.id, email: user.email, role: user.role, companyWide: user.companyWide }}
      version={JSON.parse(
        JSON.stringify(version, (_k, v) => (typeof v === "object" && v !== null && "toFixed" in v ? v.toString() : v))
      )}
      canSeeSalary={canSeeSalary}
    />
  );
}
