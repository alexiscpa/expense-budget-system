import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";

/**
 * Dashboard-scoped 404 - takes precedence over the root app/not-found.tsx
 * for any not-found triggered inside /dashboard/** (e.g. an invalid budget
 * version id - see budgets/[id]/page.tsx's notFound() call), so the exit
 * link is the correct one for a logged-in user (回到預算總覽) rather than
 * the generic root page. Rendered inside dashboard/layout.tsx, so the
 * shared DashboardNav bar's own "← 回到預算總覽" button is already present
 * above this too - this page's own link is a second, in-content way to the
 * same place, useful once the reader has scrolled past the nav bar.
 */
export default async function DashboardNotFound() {
  const user = await getCurrentUser();

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-bold">找不到頁面</h1>
      <p className="text-sm text-slate-600">您要查看的預算版本或頁面不存在，或已被移除。</p>
      {user ? (
        <Link href="/dashboard" className="rounded bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700">
          ← 回到預算總覽
        </Link>
      ) : (
        <Link href="/login" className="rounded bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700">
          回到登入頁
        </Link>
      )}
    </main>
  );
}
