"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ClientApiError } from "@/lib/client/api";

interface DepartmentOption {
  id: string;
  code: string;
  name: string;
}

export function CreateBudgetVersionForm({
  departments,
  defaultFiscalYear,
}: {
  departments: DepartmentOption[];
  defaultFiscalYear?: number;
}) {
  const router = useRouter();
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? "");
  const [fiscalYear, setFiscalYear] = useState(String(defaultFiscalYear ?? new Date().getFullYear()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ version: { id: string } }>("/api/budgets", {
        method: "POST",
        body: JSON.stringify({ departmentId, fiscalYear: Number(fiscalYear) }),
      });
      router.push(`/dashboard/budgets/${result.version.id}`);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : "建立失敗");
    } finally {
      setBusy(false);
    }
  }

  if (departments.length === 0) {
    return (
      <p className="mb-8 rounded border border-slate-200 px-4 py-3 text-sm text-slate-500">
        目前沒有可用的部門主檔，請先匯入部門資料，或（Preview 測試環境）先執行上方「初始化 DEMO 主檔」。
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mb-8 flex flex-wrap items-end gap-3 rounded border border-slate-200 p-4">
      <div>
        <label className="mb-1 block text-xs text-slate-500">部門</label>
        <select
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        >
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code} - {d.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-500">年度</label>
        <input
          type="number"
          min={2000}
          max={2100}
          value={fiscalYear}
          onChange={(e) => setFiscalYear(e.target.value)}
          className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={busy || !departmentId}
        className="rounded bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {busy ? "建立中..." : "建立預算版本草稿"}
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
