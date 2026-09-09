"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ClientApiError } from "@/lib/client/api";

interface DepartmentSummary {
  code: string;
  name: string;
  class: "M" | "S" | "R" | "P";
  isOverseas: boolean;
  headcount2026: number;
  accountCount: number;
  totalProjection2026: string;
}

interface SeedResult {
  departmentsCreated: number;
  accountsCreated: number;
  budgetVersionsCreated: number;
  budgetLinesCreated: number;
  departments: DepartmentSummary[];
}

const CLASS_LABEL: Record<string, string> = { M: "管理", S: "營業", R: "研發", P: "生產" };

function formatAmount(value: string): string {
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return num.toLocaleString("zh-TW");
}

const CONFIRM_MESSAGE =
  "即將建立 8 個測試部門（管理/營業/研發/生產各 2 個，含 1 個海外營業據點）並產生其 2026 年推估資料。\n\n" +
  "本操作：\n" +
  "・不會建立或代填 2027 年預算金額\n" +
  "・不會影響財務管理處或其他既有正式資料\n" +
  "・可重複執行，不會產生重複部門、科目或推估資料\n\n" +
  "確定要建立測試資料嗎？";

export function Stage2ASeedPanel({ initialStatus }: { initialStatus: DepartmentSummary[] | null }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [departments, setDepartments] = useState<DepartmentSummary[] | null>(initialStatus);

  async function handleConfirm() {
    if (!window.confirm(CONFIRM_MESSAGE)) {
      setConfirming(false);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ result: SeedResult }>("/api/demo/stage2a-seed", { method: "POST" });
      setDepartments(res.result.departments);
      router.refresh();
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : "建立測試資料失敗");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="mb-8 rounded border border-sky-300 bg-sky-50 p-4">
      <p className="mb-1 text-sm font-semibold text-sky-900">Stage 2A：8 部門 2026 推估測試資料（僅限 Vercel Preview 測試環境）</p>
      <p className="mb-3 text-xs text-sky-800">
        建立管理/營業/研發/生產各 2 個代表部門（含 1 個海外營業據點）及其適用科目，並產生 2026 年度推估人數與各科目推估金額，供人工編製
        2027 年度測試預算。不會代填 2027 年金額，不會影響財務管理處或其他既有正式資料，可重複執行不產生重複資料。
      </p>

      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          disabled={busy}
          className="rounded bg-sky-600 px-4 py-2 text-sm text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {departments ? "重新確認 8 部門測試資料" : "建立8部門2026推估測試資料"}
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-sky-900">確定要建立 8 個測試部門的 2026 推估資料嗎？此操作不會影響任何正式資料。</span>
          <button
            onClick={handleConfirm}
            disabled={busy}
            className="rounded bg-sky-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            {busy ? "處理中..." : "確認執行"}
          </button>
          <button onClick={() => setConfirming(false)} disabled={busy} className="rounded border border-sky-400 px-3 py-1 text-sm">
            取消
          </button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {departments && (
        <div className="mt-3 overflow-x-auto rounded bg-white p-3 text-xs text-slate-700">
          <p className="mb-2 font-medium text-slate-900">目前 8 部門測試資料狀態：</p>
          <table className="w-full min-w-[600px] border-collapse">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="pr-3">代碼</th>
                <th className="pr-3">名稱</th>
                <th className="pr-3">類別</th>
                <th className="pr-3">國內/海外</th>
                <th className="pr-3">2026推估人數</th>
                <th className="pr-3">科目數</th>
                <th className="pr-3">2026推估總額</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((d) => (
                <tr key={d.code} className="border-t border-slate-100">
                  <td className="py-1 pr-3">{d.code}</td>
                  <td className="py-1 pr-3">{d.name}</td>
                  <td className="py-1 pr-3">{CLASS_LABEL[d.class]}</td>
                  <td className="py-1 pr-3">{d.isOverseas ? "海外" : "國內"}</td>
                  <td className="py-1 pr-3">{d.headcount2026}</td>
                  <td className="py-1 pr-3">{d.accountCount}</td>
                  <td className="py-1 pr-3">{formatAmount(d.totalProjection2026)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
