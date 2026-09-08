import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { isAuthBypassEnabled } from "@/lib/env";
import { DEMO_DEPARTMENT_CODE } from "@/lib/demo/constants";
import { PREVIEW_TARGET_FISCAL_YEAR } from "@/lib/reports/budgetSummaryPreviewData";
import { BudgetSummaryPreviewClient } from "./BudgetSummaryPreviewClient";

export const dynamic = "force-dynamic";

/**
 * Stage 1 layout preview of the eventual multi-department budget summary
 * report (see BudgetSummaryPreviewClient.tsx for the full contract). This
 * route - and its Dashboard entry point (see dashboard/page.tsx) - must
 * only ever be reachable under the exact same fail-closed gate as every
 * other Preview-only feature in this app (isAuthBypassEnabled(): hard-
 * blocked in Production regardless of any other setting, and requires both
 * VERCEL_ENV=preview and AUTH_DISABLED=true otherwise - see lib/env.ts).
 * Read-only: this page never writes to the database. It reads the single
 * real BudgetVersion this Preview environment might have for 財務管理處／
 * 17203 whose fiscalYear is exactly PREVIEW_TARGET_FISCAL_YEAR (2027), and
 * otherwise renders nothing but hand-typed representative department names
 * with "—" placeholders - no other Department/Account/BudgetVersion rows
 * are created, imported, or assumed to exist.
 */
export default async function BudgetSummaryPreviewPage() {
  if (!isAuthBypassEnabled()) notFound();

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const financeDepartment = await prisma.department.findUnique({ where: { code: DEMO_DEPARTMENT_CODE } });

  // Deliberately scoped to fiscalYear=PREVIEW_TARGET_FISCAL_YEAR only - an
  // existing fiscalYear=2026 (or any other year) BudgetVersion for this
  // department must NEVER be picked up and displayed under the "2027目標"
  // columns (see spec 五-4). If no such version exists yet, financeVersion
  // is simply null and the client renders the "2027年度尚未編製" state.
  const financeVersion = financeDepartment
    ? await prisma.budgetVersion.findFirst({
        where: { departmentId: financeDepartment.id, fiscalYear: PREVIEW_TARGET_FISCAL_YEAR },
        orderBy: [{ versionNumber: "desc" }, { updatedAt: "desc" }],
        include: { lines: { include: { account: true } } },
      })
    : null;

  const serializedVersion = financeVersion
    ? JSON.parse(
        JSON.stringify(financeVersion, (_k, v) =>
          typeof v === "object" && v !== null && "toFixed" in v ? v.toString() : v
        )
      )
    : null;

  return (
    <BudgetSummaryPreviewClient
      financeDepartment={financeDepartment ? { code: financeDepartment.code, name: financeDepartment.name } : null}
      financeVersion={serializedVersion}
    />
  );
}
