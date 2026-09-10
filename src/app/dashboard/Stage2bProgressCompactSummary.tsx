import Link from "next/link";
import type { Stage2bProgressSummary } from "@/lib/reports/stage2bProgress";

/**
 * Compact "2027年度預算編製進度" block for the Dashboard home page -
 * replaces the previous 8 status cards + 3 ratio cards + filters + full
 * 45-department table, which made the home page too long to scan at a
 * glance. Shows only the single number that matters on a landing page
 * (完成部門數／應編部門數 and the completion rate), with a link to the
 * full detail page (/dashboard/budget-progress) for anyone who needs the
 * per-department breakdown, filters, amounts, or headcounts.
 *
 * "已完成" here is deliberately `completedPreparationCount` - a department
 * has genuinely finished preparing its budget (READY_TO_SUBMIT/SUBMITTED/
 * UNDER_REVIEW/APPROVED), never merely "started" (which would wrongly
 * count IN_PROGRESS/DRAFT_EMPTY) and never RETURNED (a department sent
 * back for correction is not done, even though it was briefly complete
 * before being returned) - see loadStage2bProgress's own derivation.
 */
export function Stage2bProgressCompactSummary({ summary }: { summary: Stage2bProgressSummary }) {
  const completed = summary.completedPreparationCount;
  const total = summary.totalDepartments;
  const incomplete = total - completed;
  const percent = summary.completedPreparationPercent;

  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-lg font-bold">2027年度預算編製進度</h2>
      <p className="text-sm text-slate-600">
        已完成 <span className="font-semibold text-slate-900">{completed}</span> 個部門／應編{" "}
        <span className="font-semibold text-slate-900">{total}</span> 個部門
      </p>
      <p className="mb-3 text-sm text-slate-600">
        完成率 <span className="font-semibold text-slate-900">{percent}%</span>
      </p>

      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="2027年度預算編製完成率"
        className="mb-3 h-3 w-full overflow-hidden rounded-full bg-slate-200"
      >
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(percent, 100)}%` }} />
      </div>

      <div className="mb-4 flex gap-6 text-sm">
        <p>
          已完成：<span className="font-semibold text-green-700">{completed}</span>
        </p>
        <p>
          未完成：<span className="font-semibold text-amber-700">{incomplete}</span>
        </p>
      </div>

      <Link
        href="/dashboard/budget-progress"
        className="inline-block rounded bg-brand-600 px-4 py-2 text-sm text-white hover:bg-brand-700"
      >
        查看部門明細
      </Link>
    </div>
  );
}
