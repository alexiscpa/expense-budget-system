"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch, ClientApiError } from "@/lib/client/api";
import type { Stage2bDepartmentProgress, Stage2bWorkflowStatus } from "@/lib/reports/stage2bProgress";

const CLASS_LABEL: Record<string, string> = { M: "管理", S: "營業", R: "研發", P: "生產", UNCLASSIFIED: "待確認" };
const STATUS_LABEL: Record<Stage2bWorkflowStatus, string> = {
  NOT_STARTED: "尚未開始",
  DRAFT_EMPTY: "已建立草稿（尚未填寫）",
  IN_PROGRESS: "編製中",
  READY_TO_SUBMIT: "已完成待送出",
  SUBMITTED: "已送出",
  UNDER_REVIEW: "審核中",
  RETURNED: "退回修改",
  APPROVED: "已核准",
};
const STATUS_COLOR: Record<Stage2bWorkflowStatus, string> = {
  NOT_STARTED: "text-slate-500",
  DRAFT_EMPTY: "text-slate-500",
  IN_PROGRESS: "text-amber-600",
  READY_TO_SUBMIT: "text-blue-600",
  SUBMITTED: "text-indigo-600",
  UNDER_REVIEW: "text-indigo-600",
  RETURNED: "text-red-600",
  APPROVED: "text-green-600",
};

function formatAmount(value: string | null): string {
  if (value === null) return "—";
  const num = Number(value);
  if (Number.isNaN(num)) return "—";
  return num.toLocaleString("zh-TW");
}

type CategoryFilter = "ALL" | "M" | "S" | "R" | "P";
type OverseasFilter = "ALL" | "DOMESTIC" | "OVERSEAS";
type StatusFilter = "ALL" | Stage2bWorkflowStatus;

export function Stage2bProgressTable({
  rows,
  canStartPreparation,
}: {
  rows: Stage2bDepartmentProgress[];
  /** false for a read-only viewer (e.g. AUDITOR/READ_ONLY) who may see the table but must not trigger 開始編製. */
  canStartPreparation: boolean;
}) {
  const router = useRouter();
  const [category, setCategory] = useState<CategoryFilter>("ALL");
  const [overseas, setOverseas] = useState<OverseasFilter>("ALL");
  const [status, setStatus] = useState<StatusFilter>("ALL");
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (category === "ALL" || r.class === category) &&
          (overseas === "ALL" || r.domesticOrOverseas === overseas) &&
          (status === "ALL" || r.status === status)
      ),
    [rows, category, overseas, status]
  );

  async function handleStart(row: Stage2bDepartmentProgress) {
    if (!row.departmentId) {
      setError(`${row.code} 尚未建立部門主檔，請先執行部門主檔初始化`);
      return;
    }
    setBusyCode(row.code);
    setError(null);
    try {
      const res = await apiFetch<{ version: { id: string } }>("/api/budgets/stage2b-start", {
        method: "POST",
        body: JSON.stringify({ departmentId: row.departmentId }),
      });
      router.push(`/dashboard/budgets/${res.version.id}`);
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : "建立草稿失敗");
    } finally {
      setBusyCode(null);
    }
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-3 text-sm">
        <label className="flex items-center gap-1">
          類別：
          <select value={category} onChange={(e) => setCategory(e.target.value as CategoryFilter)} className="rounded border px-2 py-1">
            <option value="ALL">全部</option>
            <option value="M">管理</option>
            <option value="S">營業</option>
            <option value="R">研發</option>
            <option value="P">生產</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          國內／海外：
          <select value={overseas} onChange={(e) => setOverseas(e.target.value as OverseasFilter)} className="rounded border px-2 py-1">
            <option value="ALL">全部</option>
            <option value="DOMESTIC">國內</option>
            <option value="OVERSEAS">海外</option>
          </select>
        </label>
        <label className="flex items-center gap-1">
          編製狀態：
          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className="rounded border px-2 py-1">
            <option value="ALL">全部</option>
            {(Object.keys(STATUS_LABEL) as Stage2bWorkflowStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <span className="ml-auto self-center text-xs text-slate-500">
          顯示 {filtered.length} / {rows.length} 筆
        </span>
      </div>

      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="w-full min-w-[1100px] border-collapse text-sm">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="px-2 py-2">部門代碼</th>
              <th className="px-2 py-2">部門名稱</th>
              <th className="px-2 py-2">類別</th>
              <th className="px-2 py-2">國內／海外</th>
              <th className="px-2 py-2">2026推估人數</th>
              <th className="px-2 py-2">2026推估總額</th>
              <th className="px-2 py-2">2027編製人數</th>
              <th className="px-2 py-2">2027預算總額</th>
              <th className="px-2 py-2">已確認／應填科目數</th>
              <th className="px-2 py-2">完成百分比</th>
              <th className="px-2 py-2">工作流程狀態</th>
              <th className="px-2 py-2">最後編製日期</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.code} className="border-t border-slate-200">
                <td className="px-2 py-2">{row.code}</td>
                <td className="px-2 py-2">{row.name}</td>
                <td className="px-2 py-2">{CLASS_LABEL[row.class]}</td>
                <td className="px-2 py-2">{row.domesticOrOverseas === "OVERSEAS" ? "海外" : "國內"}</td>
                <td className="px-2 py-2">{row.headcount2026 ?? "—"}</td>
                <td className="px-2 py-2">{formatAmount(row.total2026)}</td>
                <td className="px-2 py-2">{row.headcount2027 ?? "—"}</td>
                <td className="px-2 py-2">{formatAmount(row.total2027)}</td>
                <td className="px-2 py-2">
                  {row.versionId ? `${row.confirmedLineCount} / ${row.applicableLineCount}` : "—"}
                </td>
                <td className="px-2 py-2">{row.completionPercent === null ? "—" : `${row.completionPercent}%`}</td>
                <td className={`px-2 py-2 font-medium ${STATUS_COLOR[row.status]}`}>{STATUS_LABEL[row.status]}</td>
                <td className="px-2 py-2">
                  {row.lastPreparedAt ? new Date(row.lastPreparedAt).toLocaleDateString("zh-TW") : "—"}
                </td>
                <td className="px-2 py-2">
                  {row.versionId ? (
                    <Link href={`/dashboard/budgets/${row.versionId}`} className="text-brand-600 hover:underline">
                      {row.status === "NOT_STARTED" ? "檢視" : row.status === "SUBMITTED" || row.status === "UNDER_REVIEW" || row.status === "APPROVED" ? "檢視" : "繼續編製"}
                    </Link>
                  ) : canStartPreparation ? (
                    <button
                      onClick={() => handleStart(row)}
                      disabled={busyCode === row.code || !row.departmentId}
                      className="rounded bg-brand-600 px-2 py-1 text-xs text-white disabled:opacity-50"
                    >
                      {busyCode === row.code ? "建立中..." : "開始編製"}
                    </button>
                  ) : (
                    <span className="text-xs text-slate-400">尚未開始</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={13} className="px-2 py-6 text-center text-slate-400">
                  沒有符合篩選條件的部門
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
