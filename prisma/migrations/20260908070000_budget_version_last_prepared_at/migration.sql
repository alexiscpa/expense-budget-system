-- AlterTable: add as nullable first so the backfill below can run before
-- the NOT NULL constraint is applied (a bare ADD COLUMN ... NOT NULL with
-- no default would fail outright on a table that already has rows).
ALTER TABLE "BudgetVersion" ADD COLUMN     "lastPreparedAt" TIMESTAMP(3);

-- Backfill every pre-existing BudgetVersion row. Preferred source: the most
-- recent AuditLog entry that reflects an actual budget-content edit for
-- that version -
--   - BUDGET_HEADCOUNT_UPDATED, whose entityId is the BudgetVersion id
--     directly, or
--   - BUDGET_LINE_UPDATED, whose entityId is the *BudgetLine* id - joined
--     back to its owning BudgetVersion via BudgetLine.budgetVersionId.
-- This is the same real "content last touched" signal lastPreparedAt is
-- meant to track going forward, so it is safe to compute directly here (a
-- read-only correlated subquery, no risk to existing data). Falls back to
-- BudgetVersion.updatedAt only for a version with no such audit history
-- (e.g. a DRAFT never edited since creation) - reported in the PR notes as
-- the documented fallback path per the migration requirement.
UPDATE "BudgetVersion" bv
SET "lastPreparedAt" = COALESCE(
  (
    SELECT MAX(al."createdAt")
    FROM "AuditLog" al
    LEFT JOIN "BudgetLine" bl ON al."action" = 'BUDGET_LINE_UPDATED' AND al."entityId" = bl."id"
    WHERE (al."action" = 'BUDGET_HEADCOUNT_UPDATED' AND al."entityId" = bv."id")
       OR (al."action" = 'BUDGET_LINE_UPDATED' AND bl."budgetVersionId" = bv."id")
  ),
  bv."updatedAt"
);

-- AlterTable: now that every row has a value, enforce NOT NULL going forward.
ALTER TABLE "BudgetVersion" ALTER COLUMN "lastPreparedAt" SET NOT NULL;
