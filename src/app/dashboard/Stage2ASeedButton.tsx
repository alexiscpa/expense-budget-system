"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ClientApiError } from "@/lib/client/api";

const CONFIRM_MESSAGE =
  "即將建立 8 個測試部門（管理/營業/研發/生產各 2 個）並產生其 2026 年推估資料。\n\n" +
  "本操作：\n" +
  "・不會建立或代填 2027 年預算金額\n" +
  "・不會影響財務管理處或其他既有正式資料\n" +
  "・可重複執行，不會產生重複部門、科目或推估資料\n\n" +
  "確定要建立測試資料嗎？";

export function Stage2ASeedButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function handleClick() {
    if (!window.confirm(CONFIRM_MESSAGE)) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiFetch<{ result: { departments: { code: string; name: string }[] } }>(
        "/api/demo/stress-seed",
        { method: "POST" }
      );
      setResult(`已完成，共 ${res.result.departments.length} 個測試部門`);
      router.refresh();
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : "建立測試資料失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-6 rounded border border-amber-300 bg-amber-50 p-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-amber-700">
        Preview 測試環境專用
      </p>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="rounded bg-amber-600 px-4 py-2 text-sm text-white hover:bg-amber-700 disabled:opacity-50"
      >
        建立8部門2026推估測試資料
      </button>
      {result && <p className="mt-2 text-sm text-green-700">{result}</p>}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
