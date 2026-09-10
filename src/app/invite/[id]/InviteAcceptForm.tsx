"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ClientApiError } from "@/lib/client/api";

interface InviteInfo {
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "LOCKED" | "REVOKED";
  maskedEmail: string;
  department: { code: string; name: string };
  expiresAt: string;
}

const TERMINAL_MESSAGE: Record<Exclude<InviteInfo["status"], "PENDING">, string> = {
  ACCEPTED: "此邀請已完成驗證並使用過，Token 僅能使用一次。",
  EXPIRED: "此邀請已超過 21 天有效期限，請聯絡管理者重新發送邀請。",
  LOCKED: "此邀請因多次輸入錯誤已被鎖定，請聯絡管理者重新發送邀請。",
  REVOKED: "此邀請已被管理者撤銷。",
};

/**
 * The token itself never appears anywhere in this component's URL/props -
 * only `invitationId` (from the page's own dynamic route segment) does.
 * The visitor must have received the plaintext token through a separate
 * channel from an administrator (見 Stage 2B-3 三部門邀請登入 Pilot
 * requirement三／四) and types it in below.
 */
export function InviteAcceptForm({ invitationId }: { invitationId: string }) {
  const router = useRouter();
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [terminalStatus, setTerminalStatus] = useState<Exclude<InviteInfo["status"], "PENDING"> | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    apiFetch<InviteInfo>(`/api/invite/${invitationId}`)
      .then((data) => {
        setInfo(data);
        if (data.status !== "PENDING") setTerminalStatus(data.status);
      })
      .catch((err) => setLoadError(err instanceof ClientApiError ? err.message : "無法載入邀請資訊"));
  }, [invitationId]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setLoading(true);
    try {
      await apiFetch(`/api/invite/${invitationId}/accept`, {
        method: "POST",
        body: JSON.stringify({ token, remember }),
      });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      if (err instanceof ClientApiError) {
        setSubmitError(err.message);
        // A terminal-state error surfaced only at submit time (e.g. it
        // expired/got locked between page load and submit) replaces the
        // form with the same terminal message a fresh page load would show.
        const reason = err.reason;
        if (reason && reason !== "WRONG_TOKEN" && reason !== "NOT_FOUND") {
          setTerminalStatus(
            reason === "ALREADY_ACCEPTED" ? "ACCEPTED" : (reason as Exclude<InviteInfo["status"], "PENDING">)
          );
        }
      } else {
        setSubmitError("驗證失敗，請稍後再試");
      }
    } finally {
      setLoading(false);
    }
  }

  if (loadError) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-bold">無法載入邀請</h1>
        <p className="text-sm text-slate-600">{loadError}</p>
      </main>
    );
  }

  if (!info) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-6 text-center text-sm text-slate-500">
        載入中...
      </main>
    );
  }

  if (terminalStatus) {
    return (
      <main className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-bold">
          {info.department.name}（{info.department.code}）邀請
        </h1>
        <p className="text-sm text-slate-600">{TERMINAL_MESSAGE[terminalStatus]}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 px-6">
      <h1 className="text-xl font-bold">部門邀請驗證</h1>
      <p className="text-sm text-slate-600">
        邀請部門：
        <strong>
          {info.department.name}（{info.department.code}）
        </strong>
        <br />
        邀請信箱：{info.maskedEmail}
      </p>
      <p className="text-xs text-amber-700">
        請輸入管理者另行提供給您的驗證碼（此驗證碼不會出現在邀請郵件中）。
      </p>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          驗證碼
          <input
            type="text"
            required
            autoComplete="one-time-code"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          在這台裝置保持登入 15 天
        </label>
        {submitError && <p className="text-sm text-red-600">{submitError}</p>}
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-brand-600 px-4 py-2 text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? "驗證中..." : "驗證並登入"}
        </button>
      </form>
    </main>
  );
}
