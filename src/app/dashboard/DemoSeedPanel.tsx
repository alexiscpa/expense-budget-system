"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ClientApiError } from "@/lib/client/api";

interface SeedResult {
  department: { id: string; code: string; name: string };
  accounts: { id: string; code: string; name: string; seq: number }[];
  fiscalYear: number;
  accountCount: number;
  priorYearReferenceTotal: string;
  legacyRetired: { departments: string[]; accounts: string[] };
}

function formatAmount(value: string): string {
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return num.toLocaleString("zh-TW");
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
      <p className="mb-1 text-xs text-amber-700">
        建立財務管理處（17203）62 筆明細費用科目（來源：2026年度費用預算V2--財務.xlsx／財務工作表），供您在畫面上親自建立與輸入
        2026 年度測試預算。可重複執行，不會產生重複資料。科目代碼為「暫用測試代碼」（如 FIN-003），僅對應來源檔案序號，
        <strong>待正式會計科目代碼確認</strong>，並非正式會計科目代碼。
      </p>
      <p className="mb-3 text-xs text-amber-700">
        不會預先建立任何 2026 預算金額——金額需由您在下方「建立預算版本」後親自輸入；2025 推估金額（來源檔案「2025推移」欄）
        僅供畫面唯讀參考。若偵測到舊版的 3 筆 DEMO-ACC-* 測試科目，會安全停用（不刪除）並以本次 62 筆真實明細取代。
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
            確定要建立／確認財務管理處測試主檔（62 筆明細科目）嗎？此操作不會影響任何正式資料。
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
          <p>
            測試部門：{result.department.code} - {result.department.name}
            <span className="ml-1 rounded bg-amber-200 px-1 text-[10px] font-medium text-amber-900">測試資料</span>
          </p>
          <p>明細科目筆數：{result.accountCount} 筆（FIN-{String(result.accounts[0]?.seq ?? 0).padStart(3, "0")} ～ FIN-
            {String(result.accounts[result.accounts.length - 1]?.seq ?? 0).padStart(3, "0")}）</p>
          <p>2025 推估金額總計（僅供參考）：{formatAmount(result.priorYearReferenceTotal)}</p>
          <p>建議測試預算年度：{result.fiscalYear}</p>
          {(result.legacyRetired.departments.length > 0 || result.legacyRetired.accounts.length > 0) && (
            <p className="mt-1 text-amber-700">
              本次已安全停用舊版 DEMO 測試資料：
              {[...result.legacyRetired.departments, ...result.legacyRetired.accounts].join("、")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
