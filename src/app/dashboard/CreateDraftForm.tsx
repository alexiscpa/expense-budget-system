"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ClientApiError } from "@/lib/client/api";

export function CreateDraftForm({ departments }: { departments: { id: string; name: string; code: string }[] }) {
  const router = useRouter();
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? "");
  const [fiscalYear, setFiscalYear] = useState(new Date().getFullYear() + 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (departments.length === 0) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ version: { id: string } }>("/api/budgets", {
        method: "POST",
        body: JSON.stringify({ departmentId, fiscalYear }),
      });
      router.push(`/dashboard/budgets/${result.version.id}`);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : "建立失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6 flex flex-wrap items-end gap-2 rounded border border-slate-200 p-4">
      <label className="flex flex-col gap-1 text-sm">
        部門
        <select
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        >
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}（{d.code}）
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        年度
        <input
          type="number"
          value={fiscalYear}
          onChange={(e) => setFiscalYear(Number(e.target.value))}
          className="w-24 rounded border border-slate-300 px-2 py-1"
        />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
      >
        建立年度預算草稿
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
