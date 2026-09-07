"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ClientApiError } from "@/lib/client/api";

interface SeedResult {
  department: { id: string; code: string; name: string };
  accounts: { id: string; code: string; name: string }[];
  fiscalYear: number;
}

export function DemoSeedPanel({ initialStatus }: { initialStatus: SeedResult | null }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SeedResult | null>(initialStatus);

  async function handleConfirm() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ result: SeedResult }>("/api/demo/seed", { method: "POST" });
      setResult(res.result);
      router.refresh();
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : "初始化失敗");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="mb-8 rounded border border-amber-300 bg-amber-50 p-4">
      <p className="mb-1 text-sm font-semibold text-amber-800">DEMO 測試主檔初始化（僅限 Vercel Preview 測試環境）</p>
      <p className="mb-3 text-xs text-amber-700">
        建立固定的 DEMO 測試部門與 3 個一般費用測試科目，供您在畫面上親自建立與輸入測試預算。可重複執行，不會產生重複資料，
        也不會建立或清除任何其他正式資料。不會預先建立任何預算金額或明細——金額需由您在下方「建立預算版本」後親自輸入。
      </p>

      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          disabled={busy}
          className="rounded bg-amber-600 px-4 py-2 text-sm text-white hover:bg-amber-700 disabled:opacity-50"
        >
          {result ? "重新確認 DEMO 主檔" : "初始化 DEMO 主檔"}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-amber-800">
            確定要建立／確認 DEMO 測試部門與 3 個測試科目嗎？此操作不會影響任何正式資料。
          </span>
          <button
            onClick={handleConfirm}
            disabled={busy}
            className="rounded bg-amber-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            {busy ? "處理中..." : "確認執行"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            disabled={busy}
            className="rounded border border-amber-400 px-3 py-1 text-sm"
          >
            取消
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {result && (
        <div className="mt-3 rounded bg-white p-3 text-xs text-slate-700">
          <p className="mb-1 font-medium text-slate-900">目前 DEMO 主檔狀態：</p>
          <p>測試部門：{result.department.code} - {result.department.name}</p>
          <p>測試科目：{result.accounts.map((a) => `${a.code} ${a.name}`).join("、")}</p>
          <p>建議測試預算年度：{result.fiscalYear}</p>
        </div>
      )}
    </div>
  );
}
