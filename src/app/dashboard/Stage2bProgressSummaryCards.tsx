import type { Stage2bProgressSummary } from "@/lib/reports/stage2bProgress";

function Card({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-3 text-center">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-xl font-bold ${accent ?? "text-slate-900"}`}>{value}</p>
    </div>
  );
}

/**
 * 2027年度預算編製進度 summary cards. Deliberately shows THREE distinct
 * completion percentages (started/completed-preparation/submitted), never
 * one blended number - see Stage 2B-2 §四 "不得只提供一個意義不清楚的百分比".
 */
export function Stage2bProgressSummaryCards({ summary }: { summary: Stage2bProgressSummary }) {
  return (
    <div className="mb-4">
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        <Card label="應編部門" value={summary.totalDepartments} />
        <Card label="尚未開始" value={summary.notStarted} />
        <Card label="編製中" value={summary.inProgress} accent="text-amber-600" />
        <Card label="已完成待送出" value={summary.readyToSubmit} accent="text-blue-600" />
        <Card label="已送出" value={summary.submitted} accent="text-indigo-600" />
        <Card label="審核中" value={summary.underReview} accent="text-indigo-600" />
        <Card label="退回修改" value={summary.returned} accent="text-red-600" />
        <Card label="已核准" value={summary.approved} accent="text-green-600" />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Card label={`已開始部門數 ÷ ${summary.totalDepartments}`} value={`${summary.startedCount} 部門（${summary.startedPercent}%）`} />
        <Card
          label={`已完成編製部門數 ÷ ${summary.totalDepartments}`}
          value={`${summary.completedPreparationCount} 部門（${summary.completedPreparationPercent}%）`}
        />
        <Card
          label={`已送出部門數 ÷ ${summary.totalDepartments}`}
          value={`${summary.submittedOrBeyondCount} 部門（${summary.submittedPercent}%）`}
        />
      </div>
      {summary.notYetInSystem > 0 && (
        <p className="mt-2 text-xs text-amber-600">
          尚有 {summary.notYetInSystem} 個名冊部門尚未建立主檔（部門主檔初始化尚未執行或尚未完成）。
        </p>
      )}
    </div>
  );
}
