import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { isAuthBypassEnabled } from "@/lib/env";
import { DEMO_DEPARTMENT_CODE } from "@/lib/demo/constants";
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
 * real BudgetVersion this Preview environment has (財務管理處／17203, if
 * one has been created through the screen) and otherwise renders nothing
 * but hand-typed representative department names with "—" placeholders -
 * no other Department/Account/BudgetVersion rows are created, imported, or
 * assumed to exist.
 */
export default async function BudgetSummaryPreviewPage() {
  if (!isAuthBypassEnabled()) notFound();

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const financeDepartment = await prisma.department.findUnique({ where: { code: DEMO_DEPARTMENT_CODE } });

  // Picks whichever BudgetVersion for 財務管理處 was most recently touched
  // (across any fiscal year/version created during this Preview
  // environment's lifetime) as "the" current figure to preview - the exact
  // row is never written to, only read.
  const financeVersion = financeDepartment
    ? await prisma.budgetVersion.findFirst({
        where: { departmentId: financeDepartment.id },
        orderBy: [{ fiscalYear: "desc" }, { versionNumber: "desc" }, { updatedAt: "desc" }],
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
