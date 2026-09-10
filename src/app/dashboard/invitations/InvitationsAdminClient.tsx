"use client";

import { useState } from "react";
import { apiFetch, ClientApiError } from "@/lib/client/api";

interface Department {
  id: string;
  code: string;
  name: string;
}

interface InvitationRow {
  id: string;
  email: string;
  status: string;
  attemptCount: number;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  acceptedByUserId: string | null;
  department: { id: string; code: string; name: string };
  createdBy: { name: string; email: string };
  acceptedBy: { name: string; email: string } | null;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: "待驗證",
  ACCEPTED: "已接受",
  EXPIRED: "已過期",
  LOCKED: "已鎖定",
  REVOKED: "已撤銷",
};

export function InvitationsAdminClient({
  departments,
  initialInvitations,
}: {
  departments: Department[];
  initialInvitations: InvitationRow[];
}) {
  const [invitations, setInvitations] = useState(initialInvitations);
  const [departmentId, setDepartmentId] = useState(departments[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [lastCreated, setLastCreated] = useState<{
    token: string;
    invitationUrl: string;
    departmentCode: string;
    email: string;
    emailSent: boolean;
    emailReason?: string;
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function refresh() {
    const res = await apiFetch<{ invitations: InvitationRow[] }>("/api/invitations");
    setInvitations(res.invitations);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const res = await apiFetch<{
        invitation: { id: string; departmentId: string; email: string; expiresAt: string };
        token: string;
        emailSent: boolean;
        emailReason?: string;
      }>("/api/invitations", {
        method: "POST",
        body: JSON.stringify({ departmentId, email }),
      });
      const dept = departments.find((d) => d.id === departmentId);
      setLastCreated({
        token: res.token,
        invitationUrl: `${window.location.origin}/invite/${res.invitation.id}`,
        departmentCode: dept?.code ?? "",
        email: res.invitation.email,
        emailSent: res.emailSent,
        emailReason: res.emailReason,
      });
      setEmail("");
      await refresh();
    } catch (err) {
      setCreateError(err instanceof ClientApiError ? err.message : "建立邀請失敗");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevokeInvitation(id: string) {
    setActionError(null);
    try {
      await apiFetch(`/api/invitations/${id}/revoke`, { method: "POST" });
      await refresh();
    } catch (err) {
      setActionError(err instanceof ClientApiError ? err.message : "撤銷失敗");
    }
  }

  async function handleRevokeAccess(userId: string, deptId: string) {
    setActionError(null);
    try {
      await apiFetch(`/api/users/${userId}/department-access/revoke`, {
        method: "POST",
        body: JSON.stringify({ departmentId: deptId }),
      });
      await refresh();
    } catch (err) {
      setActionError(err instanceof ClientApiError ? err.message : "撤銷授權失敗");
    }
  }

  async function handleRevokeSessions(userId: string) {
    setActionError(null);
    try {
      await apiFetch(`/api/users/${userId}/revoke-sessions`, { method: "POST" });
    } catch (err) {
      setActionError(err instanceof ClientApiError ? err.message : "撤銷 Session 失敗");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-bold">建立新邀請</h2>
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            部門
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1"
            >
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} - {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            受邀 Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1"
            />
          </label>
          <button
            type="submit"
            disabled={creating || !departmentId}
            className="rounded bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {creating ? "建立中..." : "建立邀請"}
          </button>
        </form>
        {createError && <p className="mt-2 text-sm text-red-600">{createError}</p>}

        {lastCreated && (
          <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-4">
            <p className="mb-2 text-sm font-bold text-amber-900">
              驗證碼僅顯示這一次，請立即透過「電話／即時通訊」等邀請信以外的管道，提供給 {lastCreated.email}
              （{lastCreated.departmentCode}）：
            </p>
            <p className="mb-2 break-all rounded bg-white px-3 py-2 font-mono text-sm">{lastCreated.token}</p>
            <p className="mb-1 text-xs text-slate-600">
              邀請網址（可放心透過 Email 寄送，不含驗證碼）：
              <br />
              <span className="break-all">{lastCreated.invitationUrl}</span>
            </p>
            {lastCreated.emailSent ? (
              <p className="text-xs text-green-700">已寄出邀請 Email（僅含網址，不含驗證碼）。</p>
            ) : (
              <p className="text-xs text-red-700">
                Email 尚未寄出（原因：{lastCreated.emailReason === "NOT_CONFIGURED" ? "尚未設定寄信服務" : "寄信服務發生錯誤"}）
                ，請自行複製上方網址與驗證碼，透過其他管道提供給受邀者。
              </p>
            )}
          </div>
        )}
      </section>

      <section className="rounded border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-lg font-bold">邀請清單</h2>
        {actionError && <p className="mb-2 text-sm text-red-600">{actionError}</p>}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead className="bg-slate-100 text-left">
              <tr>
                <th className="px-2 py-2">部門</th>
                <th className="px-2 py-2">Email</th>
                <th className="px-2 py-2">狀態</th>
                <th className="px-2 py-2">錯誤次數</th>
                <th className="px-2 py-2">到期日</th>
                <th className="px-2 py-2">建立者</th>
                <th className="px-2 py-2">接受者</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {invitations.map((inv) => (
                <tr key={inv.id} className="border-t border-slate-200">
                  <td className="px-2 py-2">
                    {inv.department.code} - {inv.department.name}
                  </td>
                  <td className="px-2 py-2">{inv.email}</td>
                  <td className="px-2 py-2">{STATUS_LABEL[inv.status] ?? inv.status}</td>
                  <td className="px-2 py-2">{inv.attemptCount} / 5</td>
                  <td className="px-2 py-2">{new Date(inv.expiresAt).toLocaleDateString("zh-TW")}</td>
                  <td className="px-2 py-2">{inv.createdBy.email}</td>
                  <td className="px-2 py-2">{inv.acceptedBy?.email ?? "—"}</td>
                  <td className="px-2 py-2">
                    {(inv.status === "PENDING" || inv.status === "LOCKED") && (
                      <button
                        onClick={() => handleRevokeInvitation(inv.id)}
                        className="mr-2 rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                      >
                        撤銷邀請
                      </button>
                    )}
                    {inv.status === "ACCEPTED" && inv.acceptedByUserId && (
                      <>
                        <button
                          onClick={() => handleRevokeAccess(inv.acceptedByUserId!, inv.department.id)}
                          className="mr-2 rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                        >
                          撤銷部門授權
                        </button>
                        <button
                          onClick={() => handleRevokeSessions(inv.acceptedByUserId!)}
                          className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                        >
                          撤銷所有 Session
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {invitations.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-6 text-center text-slate-400">
                    尚無邀請紀錄
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
