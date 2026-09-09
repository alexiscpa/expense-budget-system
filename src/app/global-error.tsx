"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="zh-Hant">
      <body>
        <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-xl font-bold">系統發生錯誤</h1>
          <p className="text-sm text-slate-600">請稍後再試，或聯絡系統管理員。</p>
          <button
            onClick={() => reset()}
            className="rounded bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700"
          >
            重試
          </button>
        </main>
      </body>
    </html>
  );
}
