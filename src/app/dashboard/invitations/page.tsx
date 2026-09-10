import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { hasCapability } from "@/lib/rbac/permissions";
import { prisma } from "@/lib/prisma";
import { listInvitations } from "@/lib/invitations/service";
import { InvitationsAdminClient } from "./InvitationsAdminClient";

export const dynamic = "force-dynamic";

/**
 * Admin-only invitation management page (Stage 2B-3 三部門邀請登入
 * Pilot). Gated on "user.manage" here purely so a non-admin sees a plain
 * "沒有權限" message instead of a broken/empty page - every API route this
 * page calls independently re-checks the same capability server-side (see
 * lib/invitations/service.ts), so this page-level check is a UX nicety,
 * never the actual security boundary.
 */
export default async function InvitationsAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  if (!hasCapability(user.role, "user.manage")) {
    return (
      <main className="mx-auto max-w-md px-6 py-16 text-center">
        <h1 className="text-xl font-bold">沒有權限</h1>
        <p className="mt-2 text-sm text-slate-600">此頁面僅限系統管理者使用。</p>
        <Link href="/dashboard" className="mt-4 inline-block text-sm text-brand-600 hover:underline">
          ← 回到預算總覽
        </Link>
      </main>
    );
  }

  const [departments, invitations] = await Promise.all([
    prisma.department.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
    listInvitations(user),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Link href="/dashboard" className="mb-4 inline-block text-sm text-brand-600 hover:underline">
        ← 回到預算總覽
      </Link>
      <h1 className="mb-6 text-xl font-bold">部門邀請管理（Pilot 測試）</h1>
      <InvitationsAdminClient
        departments={departments}
        initialInvitations={invitations.map((i) => ({
          ...i,
          expiresAt: i.expiresAt.toISOString(),
          acceptedAt: i.acceptedAt?.toISOString() ?? null,
          revokedAt: i.revokedAt?.toISOString() ?? null,
          createdAt: i.createdAt.toISOString(),
        }))}
      />
      <Link href="/dashboard" className="mt-6 inline-block text-sm text-brand-600 hover:underline">
        ← 回到預算總覽
      </Link>
    </main>
  );
}
