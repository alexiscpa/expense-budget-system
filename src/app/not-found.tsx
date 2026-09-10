import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-bold">找不到頁面</h1>
      <p className="text-sm text-slate-600">您要查看的頁面不存在，或已被移除。</p>
      <Link href="/" className="rounded bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700">
        回首頁
      </Link>
    </main>
  );
}
