"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ClientApiError } from "@/lib/client/api";

interface InitResult {
  addedCodes: string[];
  existingCodes: string[];
  skippedCodes: { code: string; reason: string }[];
  conflicts: { code: string; reason: string }[];
  rosterSize: number;
}

const CONFIRM_MESSAGE =
  "即將依 docs/data/stage2b1-department-manifest.json 建立缺少的部門主檔（45 個編製單位名冊）。\n\n" +
  "本操作：\n" +
  "・不會建立任何 2027 BudgetVersion 或預算金額\n" +
  "・不會覆寫任何既有部門資料，也不會重新啟用已停用的部門\n" +
  "・可重複執行，不會產生重複部門\n" +
  "・禁止在 Production 環境執行\n\n" +
  "確定要執行部門主檔初始化嗎？";

/** Preview/local-only panel - visible to SYSTEM_ADMIN, gated server-side by
 * the API route's own Production block + explicit confirm requirement. */
export function BudgetOwnerInitPanel({ missingCount, rosterSize }: { missingCount: number; rosterSize: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InitResult | null>(null);

  async function handleRun() {
    if (!window.confirm(CONFIRM_MESSAGE)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ result: InitResult }>("/api/masterdata/initialize-budget-owner-departments", {
        method: "POST",
        body: JSON.stringify({ confirm: true }),
      });
      setResult(res.result);
      router.refresh();
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : "初始化失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-8 rounded border border-emerald-300 bg-emerald-50 p-4">
      <p className="mb-1 text-sm font-semibold text-emerald-900">45 個預算編製單位主檔初始化</p>
      <p className="mb-3 text-xs text-emerald-800">
        名冊共 {rosterSize} 個部門，目前尚缺 {missingCount} 個尚未建立部門主檔。僅建立 Department 主檔，不建立 2027
        BudgetVersion、不產生任何 2026 推估金額；已存在的部門完全不受影響。
      </p>
      <button
        onClick={handleRun}
        disabled={busy || missingCount === 0}
        className="rounded bg-emerald-600 px-4 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {busy ? "處理中..." : missingCount === 0 ? "45 個部門主檔皆已建立" : `建立缺少的 ${missingCount} 個部門主檔`}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {result && (
        <div className="mt-2 text-xs text-emerald-900">
          <p>
            新增 {result.addedCodes.length} 筆、既有 {result.existingCodes.length} 筆、跳過 {result.skippedCodes.length} 筆、衝突{" "}
            {result.conflicts.length} 筆。
          </p>
          {result.addedCodes.length > 0 && <p>新增代碼：{result.addedCodes.join("、")}</p>}
        </div>
      )}
    </div>
  );
}
