"use client";

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
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
  createdAt: string;
  updatedAt: string;
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

/**
 * Sanitizes a money `<input>`'s raw value while the user is still typing:
 * keeps digits, at most one decimal point, a leading minus sign, and any
 * thousands-separator commas the user typed or pasted (e.g. "1,200,000") -
 * so typing, editing, clearing, and pasting either "1200000" or
 * "1,200,000" all just work. Commas are stripped only at save time (see
 * parseAmountForSave), never while the field is being edited, so the
 * cursor never jumps mid-keystroke.
 */
function sanitizeAmountInput(raw: string): string {
  return raw.replace(/[^\d.,-]/g, "");
}

/** Strips thousands-separator commas/whitespace before sending to the API - the server must always receive a plain numeric string, never "1,200,000". */
function parseAmountForSave(raw: string): string {
  const stripped = raw.replace(/[,\s]/g, "").trim();
  return stripped === "" ? "0" : stripped;
}

/** Comma-formatted display value for a money `<input>` when it is not blank (an untouched/cleared line stays blank rather than showing "0"). */
function formatAmountInputValue(value: string): string {
  return value.trim() === "" ? "" : formatAmount(value);
}

// Sticky-column layout for the budget line table's first three columns
// (分類／科目編號／項目) - explicit, non-overlapping widths and left
// offsets shared by both the header and every body row so they stay
// perfectly aligned while the table scrolls horizontally underneath them.
const STICKY_COL = {
  category: { width: 84, left: 0 },
  code: { width: 84, left: 84 },
  item: { width: 176, left: 168 },
} as const;

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
  ): Promise<LineDto | null> {
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ line: LineDto }>(`/api/budgets/${version.id}/lines/${line.id}`, {
        method: "PATCH",
        body: JSON.stringify({ nextYearTargetExcludingNew: excludingNew, nextYearNewHireBudget: newHire, justification }),
      });
      setLines((prev) => prev.map((l) => (l.id === line.id ? { ...l, ...result.line } : l)));
      return result.line;
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : "更新失敗");
      return null;
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
              <th className="px-2 py-2" style={stickyCellStyle(STICKY_COL.category, { header: true })}>
                分類
              </th>
              <th className="px-2 py-2" style={stickyCellStyle(STICKY_COL.code, { header: true })}>
                科目編號
              </th>
              <th className="px-2 py-2" style={stickyCellStyle(STICKY_COL.item, { header: true, dividerRight: true })}>
                項目
              </th>
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

/** Shared sticky-cell inline style for the first three (frozen) table columns - see STICKY_COL. */
function stickyCellStyle(
  col: (typeof STICKY_COL)[keyof typeof STICKY_COL],
  opts: { header?: boolean; dividerRight?: boolean }
): CSSProperties {
  return {
    position: "sticky",
    left: col.left,
    width: col.width,
    minWidth: col.width,
    maxWidth: col.width,
    zIndex: opts.header ? 3 : 2,
    background: opts.header ? "#f1f5f9" /* slate-100, matches thead bg */ : "#fff",
    boxShadow: opts.dividerRight ? "2px 0 4px -2px rgba(15, 23, 42, 0.25)" : undefined,
  };
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
  onSave: (line: LineDto, excludingNew: string, newHire: string, justification: string) => Promise<LineDto | null>;
}) {
  // A line that has never been saved by the user (createdAt === updatedAt,
  // set to the exact same instant when the draft was created - see
  // createBudgetVersionDraft) shows blank inputs rather than the stored "0"
  // default, so the 2026 column never looks pre-filled. The moment the user
  // saves anything (even an explicit 0), updatedAt moves past createdAt and
  // the real stored value is shown from then on.
  const isUntouched = line.createdAt === line.updatedAt;
  const [excludingNew, setExcludingNew] = useState(isUntouched ? "" : formatAmountInputValue(line.nextYearTargetExcludingNew));
  const [newHire, setNewHire] = useState(isUntouched ? "" : formatAmountInputValue(line.nextYearNewHireBudget));
  const [justification, setJustification] = useState(line.justification ?? "");
  const canEditThisLine = editable && !line.isLocked;

  async function commit() {
    // A blank input (untouched line, or the user cleared it) means "unset",
    // which is saved as 0 - never sent to the API as an empty string, which
    // would otherwise fail validation just from clicking into and back out
    // of an empty field without typing anything. Commas/whitespace (typed
    // or pasted, e.g. "1,200,000") are stripped here so the API always
    // receives a plain numeric string.
    const savedLine = await onSave(line, parseAmountForSave(excludingNew), parseAmountForSave(newHire), justification);
    // Re-display with thousands separators immediately after a successful
    // save, using the server's own echoed values (never the raw input) -
    // on failure, leave exactly what the user typed so they can fix it.
    if (savedLine) {
      setExcludingNew(formatAmountInputValue(savedLine.nextYearTargetExcludingNew));
      setNewHire(formatAmountInputValue(savedLine.nextYearNewHireBudget));
    }
  }

  const deltaAmount = Number(line.nextYearTotal) - Number(line.priorYearOriginalBudget);

  return (
    <tr className="border-t border-slate-200">
      <td className="px-2 py-1" style={stickyCellStyle(STICKY_COL.category, {})}>
        {CATEGORY_LABELS[line.account.commonCategory]}
      </td>
      <td className="px-2 py-1" style={stickyCellStyle(STICKY_COL.code, {})}>
        {line.account.code}
      </td>
      <td
        className="truncate px-2 py-1"
        style={stickyCellStyle(STICKY_COL.item, { dividerRight: true })}
        title={line.account.name}
      >
        {line.account.name}
      </td>
      <td className="px-2 py-1" title="2025 推估金額，僅供參考，唯讀不可修改">
        {line.projectionIsComplete ? formatAmount(line.priorYearOriginalBudget) : "資料不全，待確認"}
      </td>
      <td className="px-2 py-1">
        {line.formulaStatus === "NOT_CONFIGURED" ? (
          <span className="font-medium text-red-600">尚未設定</span>
        ) : canEditThisLine ? (
          <input
            type="text"
            inputMode="decimal"
            className="w-24 rounded border border-slate-300 px-1"
            value={excludingNew}
            onChange={(e) => setExcludingNew(sanitizeAmountInput(e.target.value))}
            onBlur={commit}
            disabled={busy}
          />
        ) : line.entryTypeSnapshot === "FORMULA" && !canSeeSalary ? (
          <span title="金額由薪資資料公式計算，明細不對外開放">{formatAmount(line.nextYearTargetExcludingNew)}</span>
        ) : (
          formatAmount(line.nextYearTargetExcludingNew)
        )}
      </td>
      <td className="px-2 py-1">
        {canEditThisLine ? (
          <input
            type="text"
            inputMode="decimal"
            className="w-24 rounded border border-slate-300 px-1"
            value={newHire}
            onChange={(e) => setNewHire(sanitizeAmountInput(e.target.value))}
            onBlur={commit}
            disabled={busy}
          />
        ) : (
          formatAmount(line.nextYearNewHireBudget)
        )}
      </td>
      <td className="px-2 py-1 font-medium">{formatAmount(line.nextYearTotal)}</td>
      <td className={`px-2 py-1 ${deltaAmount < 0 ? "text-emerald-700" : deltaAmount > 0 ? "text-red-700" : ""}`}>
        {Number.isFinite(deltaAmount) ? formatAmount(deltaAmount.toString()) : "-"}
      </td>
      <td className="px-2 py-1">
        {/* 增減率 = 增減金額(2026合計－2025推估) ÷ 2025推估金額；2025推估為 0 時無法計算，
            growthRateIncludingNew 在後端已回傳 null（見 lib/money/decimal.ts#growthRate），此處顯示「－」。 */}
        {line.growthRateIncludingNew ? `${(Number(line.growthRateIncludingNew) * 100).toFixed(2)}%` : "－"}
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
