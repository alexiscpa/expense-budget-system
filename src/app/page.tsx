import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";

export default async function HomePage() {
  const user = await getCurrentUser();

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-6 text-center">
      <h1 className="text-2xl font-bold">部門費用預算編列系統</h1>
      <p className="text-slate-600">
        年度費用預算填報、財務覆核、核准與稽核追蹤平台
      </p>
      {user ? (
        <Link
          href="/dashboard"
          className="rounded bg-brand-600 px-4 py-2 text-white hover:bg-brand-700"
        >
          進入系統
        </Link>
      ) : (
        <Link
          href="/login"
          className="rounded bg-brand-600 px-4 py-2 text-white hover:bg-brand-700"
        >
          登入
        </Link>
      )}
    </main>
  );
}
