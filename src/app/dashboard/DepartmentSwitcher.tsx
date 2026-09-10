"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch, ClientApiError } from "@/lib/client/api";

interface Department {
  id: string;
  code: string;
  name: string;
}

/**
 * "多部門切換" (Stage 2B-3 三部門邀請登入 Pilot, requirement 九) - only
 * rendered by dashboard/page.tsx when the caller has more than one
 * accessible department. Switching only narrows which of the caller's OWN
 * already-authorized departments the version list below highlights/filters
 * to - see /api/session/active-department's own doc comment for why this
 * can never grant access to anything new.
 */
export function DepartmentSwitcher({ departments, activeDepartmentId }: { departments: Department[]; activeDepartmentId: string | null }) {
  const router = useRouter();
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(departmentId: string) {
    setError(null);
    setSwitching(true);
    try {
      await apiFetch("/api/session/active-department", {
        method: "POST",
        body: JSON.stringify({ departmentId }),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof ClientApiError ? err.message : "切換部門失敗");
    } finally {
      setSwitching(false);
    }
  }

  return (
    <div className="mb-4 flex items-center gap-2 text-sm">
      <label className="flex items-center gap-2">
        目前檢視部門：
        <select
          value={activeDepartmentId ?? ""}
          disabled={switching}
          onChange={(e) => handleChange(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1"
        >
          <option value="" disabled>
            全部（未指定）
          </option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code} - {d.name}
            </option>
          ))}
        </select>
      </label>
      {error && <span className="text-red-600">{error}</span>}
    </div>
  );
}
