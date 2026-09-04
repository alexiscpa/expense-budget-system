import type { BudgetStatus } from "@prisma/client";
import { ApiError } from "@/lib/rbac/guard";

/**
 * Backend-enforced budget workflow state machine.
 *
 *   DRAFT -> SUBMITTED -> UNDER_REVIEW -> RETURNED -> SUBMITTED (resubmit loop)
 *                              |
 *                              +-> APPROVED -> LOCKED -> ADJUSTMENT_PENDING -> SUBMITTED -> UNDER_REVIEW -> ADJUSTED
 *                              +-> REJECTED (terminal)
 *
 * Every transition below is also re-validated against role capability and
 * segregation-of-duties rules in src/lib/workflow/actions.ts - this table
 * only defines which (from -> action -> to) combinations exist at all. The
 * frontend must never be the only thing enforcing this; every API route
 * calls `assertTransition` before mutating a BudgetVersion.
 */
export type WorkflowAction =
  | "submit"
  | "startReview"
  | "return"
  | "resubmit"
  | "approve"
  | "reject"
  | "requestAdjustment";

interface TransitionRule {
  from: BudgetStatus;
  action: WorkflowAction;
  to: BudgetStatus | "APPROVE_TARGET"; // resolved dynamically for approve()
}

export const TRANSITIONS: TransitionRule[] = [
  { from: "DRAFT", action: "submit", to: "SUBMITTED" },
  { from: "RETURNED", action: "resubmit", to: "SUBMITTED" },
  { from: "ADJUSTMENT_PENDING", action: "submit", to: "SUBMITTED" },
  { from: "SUBMITTED", action: "startReview", to: "UNDER_REVIEW" },
  { from: "UNDER_REVIEW", action: "return", to: "RETURNED" },
  { from: "UNDER_REVIEW", action: "approve", to: "APPROVE_TARGET" },
  { from: "UNDER_REVIEW", action: "reject", to: "REJECTED" },
  { from: "LOCKED", action: "requestAdjustment", to: "ADJUSTMENT_PENDING" },
  { from: "ADJUSTED", action: "requestAdjustment", to: "ADJUSTMENT_PENDING" },
];

export class InvalidTransitionError extends ApiError {
  constructor(from: BudgetStatus, action: WorkflowAction) {
    super(409, `目前狀態「${from}」不允許執行「${action}」操作`);
  }
}

export function assertTransition(from: BudgetStatus, action: WorkflowAction): TransitionRule {
  const rule = TRANSITIONS.find((t) => t.from === from && t.action === action);
  if (!rule) throw new InvalidTransitionError(from, action);
  return rule;
}

/** Statuses in which a BudgetVersion's lines may be edited by its preparer. */
export const EDITABLE_STATUSES: BudgetStatus[] = ["DRAFT", "RETURNED", "ADJUSTMENT_PENDING"];

/** Statuses representing an immutable, officially recognized budget amount. */
export const IMMUTABLE_STATUSES: BudgetStatus[] = ["LOCKED", "ADJUSTED"];

export function isEditable(status: BudgetStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}
