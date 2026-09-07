"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ClientApiError } from "@/lib/client/api";
import { computeCategorySummary, CATEGORY_LABELS } from "@/lib/budget/categorySummary";
import type { Role, AccountCommonCategory } from "@prisma/client";

interface LineDto {
  id: string;
  accountId: string;
  account: {
    code: string;
    name: string;
    entryType: string;
    commonCategory: AccountCommonCategory;
    isProvisionalCode: boolean;
    sourceSeq: number | null;
  };
  priorPriorYearActual: string;
  priorYearOriginalBudget: string;
  currentYearProjection: string | null;
  projectionIsComplete: boolean;
  nextYearTargetExcludingNew: string;
  nextYearNewHireBudget: string;
  nextYearTotal: string;
  growthRateExcludingNew: string | null;
  growthRateIncludingNew: string | null;
  entryTypeSnapshot: string;
  formulaStatus: "NOT_APPLICABLE" | "CONFIGURED" | "NOT_CONFIGURED";
  isLocked: boolean;
  justification: string | null;
}

interface VersionDto {
  id: string;
  departmentId: string;
  fiscalYear: number;
  versionNumber: number;
  status: string;
  returnReason: string | null;
  adjustmentReason: string | null;
  department: { name: string; code: string };
  lines: LineDto[];
}

const ACTION_LABEL: Record<string, string> = {
  submit: "送出申請",
  resubmit: "重新送出",
  review: "開始覆核",
  return: "退回",
  approve: "核准",
  reject: "駁回",
  adjustment: "申請預算調整",
};

function formatAmount(value: string): string {
  const num = Number(value);
  if (Number.isNaN(num)) return value;
  return num.toLocaleString("zh-TW", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function BudgetVersionClient({
  currentUser,
  version,
  canSeeSalary,
}: {
  currentUser: { id: string; role: Role; companyWide: boolean };
  version: VersionDto;
  canSeeSalary: boolean;
}) {
  const router = useRouter();
  const [lines, setLines] = useState(version.lines);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reasonPrompt, setReasonPrompt] = useState<null | "return" | "reject" | "adjustment">(null);
  const [reasonText, setReasonText] = useState("");

  const editable = ["DRAFT", "RETURNED", "ADJUSTMENT_PENDING"].includes(version.status);
  const hasUnconfiguredFormula = lines.some((l) => l.formulaStatus === "NOT_CONFIGURED");
  const hasProvisionalCodes = lines.some((l) => l.account.isProvisionalCode);

  // Always recomputed fresh from the current line amounts - never a stored
  // subtotal - so this stays live as the user edits each 2026 figure.
  const summary2026 = useMemo(
    () =>
      computeCategorySummary(
        lines.map((l) => ({ commonCategory: l.account.commonCategory, amount: l.nextYearTotal }))
      ),
    [lines]
  );
  const summary2025Reference = useMemo(
    () =>
      computeCategorySummary(
        lines.map((l) => ({ commonCategory: l.account.commonCategory, amount: l.priorYearOriginalBudget }))
      ),
    [lines]
  );

  async function saveLine(
    line: LineDto,
    excludingNew: string,
    newHire: string,
    justification: string
  ) {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ line: LineDto }>(`/api/budgets/${version.id}/lines/${line.id}`, {
        method: "PATCH",
        body: JSON.stringify({ nextYearTargetExcludingNew: excludingNew, nextYearNewHireBudget: newHire, justification }),
      });
      setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, ...result.line } : l)));
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : "更新失敗");
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action: string, reason?: string) {
    setBusy(true);
    setError(null);
    try {
      const path =
        action === "submit"
          ? "submit"
          : action === "resubmit"
            ? "resubmit"
            : action === "review"
              ? "review"
              : action;
      await apiFetch(`/api/budgets/${version.id}/${path}`, {
        method: "POST",
        body: reason ? JSON.stringify({ reason }) : undefined,
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : "操作失敗");
    } finally {
      setBusy(false);
      setReasonPrompt(null);
      setReasonText("");
    }
  }

  const availableActions: string[] = [];
  if (version.status === "DRAFT" && !hasUnconfiguredFormula) availableActions.push("submit");
  if (version.status === "RETURNED" && !hasUnconfiguredFormula) availableActions.push("resubmit");
  if (version.status === "ADJUSTMENT_PENDING" && !hasUnconfiguredFormula) availableActions.push("submit");
  if (version.status === "SUBMITTED") availableActions.push("review");
  if (version.status === "UNDER_REVIEW") availableActions.push("return", "approve", "reject");
  if (["LOCKED", "ADJUSTED"].includes(version.status)) availableActions.push("adjustment");

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="mb-1 text-xl font-bold">
        {version.department.name} — {version.fiscalYear} 年度預算（v{version.versionNumber}）
      </h1>
      <p className="mb-4 text-sm text-slate-500">狀態：{version.status}</p>

      {version.returnReason && (
        <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          財務退回原因：{version.returnReason}
        </p>
      )}
      {hasUnconfiguredFormula && (
        <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          仍有公式科目尚未設定（顯示為「尚未設定」），無法送出或核准，請聯絡財務管理員完成公式與薪資資料來源設定。
        </p>
      )}
      {hasProvisionalCodes && (
        <p className="mb-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          本頁部分科目使用「暫用測試代碼」（如 FIN-xxx），僅為來源檔案序號對應之測試用識別碼，
          <strong>待正式會計科目代碼確認</strong>，尚非正式會計科目代碼。
        </p>
      )}
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {summary2026.rows.map((row) => (
          <div key={row.category} className="rounded border border-slate-200 p-3">
            <p className="text-xs text-slate-500">{row.label}（2026）</p>
            <p className="text-sm font-semibold">{formatAmount(row.total.toString())}</p>
            <p className="text-xs text-slate-400">
              2025 參考：{formatAmount(summary2025Reference.rows.find((r) => r.category === row.category)?.total.toString() ?? "0")}
            </p>
          </div>
        ))}
        <div className="rounded border border-brand-600 bg-brand-50 p-3">
          <p className="text-xs text-slate-500">管理費用合計（2026，即時計算）</p>
          <p className="text-sm font-semibold">{formatAmount(summary2026.grandTotal.toString())}</p>
          <p className="text-xs text-slate-400">2025 參考：{formatAmount(summary2025Reference.grandTotal.toString())}</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1500px] border-collapse text-xs">
          <thead className="bg-slate-100 text-left">
            <tr>
              <th className="px-2 py-2">分類</th>
              <th className="px-2 py-2">科目編號</th>
              <th className="px-2 py-2">項目</th>
              <th className="px-2 py-2">2025推估金額（唯讀）</th>
              <th className="px-2 py-2">2026預算金額</th>
              <th className="px-2 py-2">目標(新員)</th>
              <th className="px-2 py-2">合計(含新員)</th>
              <th className="px-2 py-2">增減金額</th>
              <th className="px-2 py-2">增減率</th>
              <th className="px-2 py-2">說明／編列依據</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <LineRow
                key={line.id}
                line={line}
                editable={editable}
                busy={busy}
                canSeeSalary={canSeeSalary}
                onSave={saveLine}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-6 flex gap-2">
        {availableActions.map((action) =>
          action === "return" || action === "reject" || action === "adjustment" ? (
            <button
              key={action}
              disabled={busy}
              onClick={() => setReasonPrompt(action as "return" | "reject" | "adjustment")}
              className="rounded border border-slate-300 px-4 py-2 text-sm hover:bg-slate-100 disabled:opacity-50"
            >
              {ACTION_LABEL[action]}
            </button>
          ) : (
            <button
              key={action}
              disabled={busy}
              onClick={() => runAction(action)}
              className="rounded bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {ACTION_LABEL[action]}
            </button>
          )
        )}
      </div>

      {reasonPrompt && (
        <div className="mt-4 max-w-md rounded border border-slate-300 p-4">
          <p className="mb-2 text-sm font-medium">請填寫{ACTION_LABEL[reasonPrompt]}原因</p>
          <textarea
            value={reasonText}
            onChange={(e) => setReasonText(e.target.value)}
            className="mb-2 w-full rounded border border-slate-300 px-2 py-1 text-sm"
            rows={3}
          />
          <div className="flex gap-2">
            <button
              disabled={busy || reasonText.trim().length === 0}
              onClick={() => runAction(reasonPrompt, reasonText)}
              className="rounded bg-brand-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              確認送出
            </button>
            <button onClick={() => setReasonPrompt(null)} className="rounded border px-3 py-1 text-sm">
              取消
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function LineRow({
  line,
  editable,
  busy,
  canSeeSalary,
  onSave,
}: {
  line: LineDto;
  editable: boolean;
  busy: boolean;
  canSeeSalary: boolean;
  onSave: (line: LineDto, excludingNew: string, newHire: string, justification: string) => void;
}) {
  const [excludingNew, setExcludingNew] = useState(line.nextYearTargetExcludingNew);
  const [newHire, setNewHire] = useState(line.nextYearNewHireBudget);
  const [justification, setJustification] = useState(line.justification ?? "");
  const canEditThisLine = editable && !line.isLocked;

  function commit() {
    onSave(line, excludingNew, newHire, justification);
  }

  const deltaAmount = Number(line.nextYearTotal) - Number(line.priorYearOriginalBudget);

  return (
    <tr className="border-t border-slate-200">
      <td className="px-2 py-1">{CATEGORY_LABELS[line.account.commonCategory]}</td>
      <td className="px-2 py-1">
        {line.account.code}
        {line.account.isProvisionalCode && (
          <span
            className="ml-1 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-800"
            title="暫用測試代碼，待正式科目代碼確認"
          >
            暫用
          </span>
        )}
      </td>
      <td className="px-2 py-1">{line.account.name}</td>
      <td className="px-2 py-1" title="2025 推估金額，僅供參考，唯讀不可修改">
        {line.projectionIsComplete ? formatAmount(line.priorYearOriginalBudget) : "資料不全，待確認"}
      </td>
      <td className="px-2 py-1">
        {line.formulaStatus === "NOT_CONFIGURED" ? (
          <span className="font-medium text-red-600">尚未設定</span>
        ) : canEditThisLine ? (
          <input
            className="w-24 rounded border border-slate-300 px-1"
            value={excludingNew}
            onChange={(e) => setExcludingNew(e.target.value)}
            onBlur={commit}
            disabled={busy}
          />
        ) : line.entryTypeSnapshot === "FORMULA" && !canSeeSalary ? (
          <span title="金額由薪資資料公式計算，明細不對外開放">{line.nextYearTargetExcludingNew}</span>
        ) : (
          line.nextYearTargetExcludingNew
        )}
      </td>
      <td className="px-2 py-1">
        {canEditThisLine ? (
          <input
            className="w-24 rounded border border-slate-300 px-1"
            value={newHire}
            onChange={(e) => setNewHire(e.target.value)}
            onBlur={commit}
            disabled={busy}
          />
        ) : (
          line.nextYearNewHireBudget
        )}
      </td>
      <td className="px-2 py-1 font-medium">{formatAmount(line.nextYearTotal)}</td>
      <td className={`px-2 py-1 ${deltaAmount < 0 ? "text-emerald-700" : deltaAmount > 0 ? "text-red-700" : ""}`}>
        {Number.isFinite(deltaAmount) ? formatAmount(deltaAmount.toString()) : "-"}
      </td>
      <td className="px-2 py-1">
        {line.growthRateExcludingNew ? `${(Number(line.growthRateExcludingNew) * 100).toFixed(2)}%` : "-"}
      </td>
      <td className="px-2 py-1">
        {canEditThisLine ? (
          <input
            className="w-40 rounded border border-slate-300 px-1"
            value={justification}
            placeholder="說明／編列依據"
            onChange={(e) => setJustification(e.target.value)}
            onBlur={commit}
            disabled={busy}
          />
        ) : (
          line.justification || "-"
        )}
      </td>
    </tr>
  );
}
