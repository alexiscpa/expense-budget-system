import { NextResponse } from "next/server";
import { requireUser, errorResponse, ApiError } from "@/lib/rbac/guard";
import { isAuthBypassEnabled } from "@/lib/env";
import { fetchFinanceDepartmentAndVersion, fetchDeptSummaryEntries } from "@/lib/reports/fetchFinanceVersion";
import { KNOWN_DEPARTMENT_CODES } from "@/lib/reports/budgetSummaryPreviewData";
import {
  DEFAULT_DATA_SCOPE,
  EXPORT_FILENAME_LABELS,
  isBudgetDataScope,
  isExportTableKey,
  type BudgetDataScope,
  type ExportTableKey,
} from "@/lib/reports/summaryReportData";
import { buildBudgetSummaryPreviewExcel } from "@/lib/excel/budgetSummaryPreviewExport";
import { buildBudgetSummaryPreviewPdf } from "@/lib/pdf/budgetSummaryPreviewPdf";
import { formatTaipeiDate } from "@/lib/format/date";

/**
 * Excel/PDF export for the budget summary preview
 * (`/dashboard/reports/budget-summary-preview`) - Stage 1B.
 *
 * Same fail-closed gate as the page itself (isAuthBypassEnabled() then
 * requireUser() - "沿用彙總頁的檢視權限"／"未授權使用者不可直接呼叫匯出
 * API"): unreachable in Production regardless of who is logged in, and a
 * 401 for anyone not logged in even when the Preview bypass is active.
 *
 * Fully read-only: Excel fetches the same multi-department query page.tsx
 * reads (fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES) - see
 * lib/excel/budgetSummaryPreviewExport.ts for the root-cause history of why
 * this must be the same call, not a separate 財務管理處-only one). PDF is
 * out of scope this round and still reads only
 * fetchFinanceDepartmentAndVersion() (財務管理處). Either way this route
 * returns a generated file with no Prisma write of any kind, INCLUDING no
 * audit log entry. Every other
 * write-adjacent endpoint in this app writes an AuditLog row (see
 * lib/excel/exportBudgetLines.ts's exportApprovedBudgetVersion for the
 * usual "official export" pattern) but Stage 1B explicitly requires
 * "匯出前後資料庫列數及內容不變" (row counts and content unchanged before
 * and after export) - an AuditLog insert would itself violate that, so
 * this route deliberately has none.
 */
export async function GET(request: Request) {
  try {
    if (!isAuthBypassEnabled()) {
      throw new ApiError(403, "此功能僅限 Vercel Preview 測試環境（AUTH_DISABLED=true）使用");
    }
    await requireUser();

    const { searchParams } = new URL(request.url);
    const tableParam = searchParams.get("table") ?? "";
    const formatParam = searchParams.get("format") ?? "";
    const scopeParam = searchParams.get("scope") ?? DEFAULT_DATA_SCOPE;

    if (!isExportTableKey(tableParam)) {
      throw new ApiError(400, `不支援的匯出表格：${tableParam}`);
    }
    if (formatParam !== "xlsx" && formatParam !== "pdf") {
      throw new ApiError(400, `不支援的匯出格式：${formatParam}`);
    }
    if (!isBudgetDataScope(scopeParam)) {
      throw new ApiError(400, `不支援的資料範圍：${scopeParam}`);
    }

    const tableKey: ExportTableKey = tableParam;
    const format: "xlsx" | "pdf" = formatParam;
    const scope: BudgetDataScope = scopeParam;

    const exportedAtIso = new Date().toISOString();

    // Excel reads the exact same multi-department query the on-screen
    // preview uses (fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES)) - see
    // lib/excel/budgetSummaryPreviewExport.ts's own doc comment for the
    // root-cause history. PDF is out of scope this round and keeps reading
    // only fetchFinanceDepartmentAndVersion() (財務管理處), unchanged.
    const buffer =
      format === "xlsx"
        ? await buildBudgetSummaryPreviewExcel(tableKey, {
            deptEntries: await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES),
            scope,
            exportedAtIso,
          })
        : await buildBudgetSummaryPreviewPdf(tableKey, {
            ...(await fetchFinanceDepartmentAndVersion()),
            scope,
            exportedAtIso,
          });

    const dateStamp = formatTaipeiDate(exportedAtIso).replace(/\./g, "");
    const label = EXPORT_FILENAME_LABELS[tableKey];
    const fileBaseName = `2027費用預算_${label}_${dateStamp}`;
    const asciiFallback = `budget-summary-${tableKey}-${dateStamp}`;
    const ext = format === "xlsx" ? "xlsx" : "pdf";
    const contentType =
      format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/pdf";

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${asciiFallback}.${ext}"; filename*=UTF-8''${encodeURIComponent(
          `${fileBaseName}.${ext}`
        )}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
