import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { getAccessibleDepartmentIds } from "@/lib/rbac/permissions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "草稿",
  SUBMITTED: "已送出",
  UNDER_REVIEW: "財務覆核中",
  RETURNED: "已退回",
  APPROVED: "已核准",
  LOCKED: "已鎖定",
  ADJUSTMENT_PENDING: "調整編製中",
  ADJUSTED: "已調整核定",
  REJECTED: "已駁回",
};

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const accessibleDepartmentIds = await getAccessibleDepartmentIds(user);
  const versions = await prisma.budgetVersion.findMany({
    where: {
      departmentId: accessibleDepartmentIds === null ? undefined : { in: accessibleDepartmentIds },
    },
    include: { department: true },
    orderBy: [{ fiscalYear: "desc" }, { versionNumber: "desc" }],
    take: 100,
  });

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold">預算版本總覽</h1>
        <form action="/api/auth/logout" method="post">
          <span className="mr-3 text-sm text-slate-500">
            {user.name}（{user.role}）
          </span>
        </form>
      </div>

      <table className="w-full border-collapse overflow-hidden rounded border border-slate-200 text-sm">
        <thead className="bg-slate-100 text-left">
          <tr>
            <th className="px-3 py-2">部門</th>
            <th className="px-3 py-2">年度</th>
            <th className="px-3 py-2">版本</th>
            <th className="px-3 py-2">狀態</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {versions.map((v) => (
            <tr key={v.id} className="border-t border-slate-200">
              <td className="px-3 py-2">{v.department.name}</td>
              <td className="px-3 py-2">{v.fiscalYear}</td>
              <td className="px-3 py-2">v{v.versionNumber}</td>
              <td className="px-3 py-2">{STATUS_LABEL[v.status] ?? v.status}</td>
              <td className="px-3 py-2">
                <Link href={`/dashboard/budgets/${v.id}`} className="text-brand-600 hover:underline">
                  查看
                </Link>
              </td>
            </tr>
          ))}
          {versions.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                目前沒有可查看的預算版本
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
