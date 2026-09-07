import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { canAccessDepartment, canViewSalaryDetail, hasCapability } from "@/lib/rbac/permissions";
import { TRANSITIONS, type WorkflowAction } from "@/lib/workflow/stateMachine";
import { BudgetVersionClient } from "./BudgetVersionClient";

// Maps each state-machine action to the backend capability actually
// enforced by its API route (src/lib/workflow/actions.ts), so the button
// list shown to a user reflects what they can really do - not just what
// the current status allows in the abstract. The backend re-checks all of
// this independently; this is purely so the UI doesn't offer a button that
// only 403s.
const ACTION_CAPABILITY: Record<WorkflowAction, string> = {
  submit: "budget.submit_own_department",
  resubmit: "budget.submit_own_department",
  startReview: "budget.finance_review",
  return: "budget.return",
  approve: "budget.approve",
  reject: "budget.approve",
  requestAdjustment: "budget.adjustment.request",
};

// BudgetVersionClient's action keys differ slightly from WorkflowAction.
const ACTION_KEY: Record<WorkflowAction, string> = {
  submit: "submit",
  resubmit: "resubmit",
  startReview: "review",
  return: "return",
  approve: "approve",
  reject: "reject",
  requestAdjustment: "adjustment",
};

export const dynamic = "force-dynamic";

export default async function BudgetVersionPage({ params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const version = await prisma.budgetVersion.findUnique({
    where: { id: params.id },
    include: {
      department: true,
      lines: { include: { account: true }, orderBy: { account: { code: "asc" } } },
    },
  });
  if (!version) notFound();

  const allowed = await canAccessDepartment(user, version.departmentId);
  if (!allowed) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-10">
        <p className="text-red-600">您沒有權限查看此部門的資料，如需查看請聯絡財務單位</p>
      </main>
    );
  }

  const canSeeSalary = canViewSalaryDetail(user.role);

  // Role-permitted actions for the CURRENT status - the backend
  // (src/lib/workflow/actions.ts) is still the authority and re-validates
  // everything (including segregation-of-duties, which is per-record and
  // deliberately not precomputed here); this just keeps the button list
  // honest for the signed-in user instead of showing every state-valid
  // action to everyone regardless of role.
  const availableActions = TRANSITIONS.filter((rule) => rule.from === version.status)
    .filter((rule) => hasCapability(user.role, ACTION_CAPABILITY[rule.action]))
    .map((rule) => ACTION_KEY[rule.action]);

  return (
    <BudgetVersionClient
      currentUser={{ id: user.id, role: user.role, companyWide: user.companyWide }}
      version={JSON.parse(
        JSON.stringify(version, (_k, v) => (typeof v === "object" && v !== null && "toFixed" in v ? v.toString() : v))
      )}
      canSeeSalary={canSeeSalary}
      availableActions={availableActions}
    />
  );
}
