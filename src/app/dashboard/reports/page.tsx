"use client";

import { useState } from "react";
import { apiFetch, ClientApiError } from "@/lib/client/api";

interface ConsistencyRun {
  id: string;
  fiscalYear: number;
  departmentTotal: string;
  accountTotal: string;
  difference: string;
  passed: boolean;
  detail: { message: string };
  createdAt: string;
}

export default function ReportsPage() {
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear() + 1);
  const [run, setRun] = useState<ConsistencyRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function trigger() {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ run: ConsistencyRun }>("/api/reports/consistency-check", {
        method: "POST",
        body: JSON.stringify({ fiscalYear }),
      });
      setRun(result.run);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : "執行失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="mb-4 text-xl font-bold">部門對科目雙向加總一致性檢核</h1>
      <div className="mb-4 flex items-center gap-2">
        <input
          type="number"
          value={fiscalYear}
          onChange={(e) => setFiscalYear(Number(e.target.value))}
          className="w-28 rounded border border-slate-300 px-2 py-1"
        />
        <button
          disabled={busy}
          onClick={trigger}
          className="rounded bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
        >
          執行檢核
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {run && (
        <div className={`rounded p-4 text-sm ${run.passed ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
          <p>部門別加總：{run.departmentTotal}</p>
          <p>科目別加總：{run.accountTotal}</p>
          <p>差額：{run.difference}</p>
          <p className="mt-2 font-medium">{run.detail.message}</p>
        </div>
      )}
    </main>
  );
}
