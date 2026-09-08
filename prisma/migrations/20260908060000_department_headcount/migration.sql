-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "priorYearHeadcount" INTEGER;

-- AlterTable
ALTER TABLE "BudgetVersion" ADD COLUMN     "priorYearHeadcount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "budgetYearHeadcount" INTEGER NOT NULL DEFAULT 0;

-- Backfill: every BudgetVersion created before this feature existed must
-- show the known real reference headcount (10 - 序1「平均人數」in the
-- source spreadsheet, see demo/constants.ts) rather than the structural
-- zero-default above, which would otherwise misrepresent a pre-existing
-- version as having zero department headcount. This only ever runs once,
-- against rows that predate this migration - it never touches a row
-- created afterwards (those already get their real value from
-- createBudgetVersionDraft at insert time).
UPDATE "BudgetVersion" SET "priorYearHeadcount" = 10, "budgetYearHeadcount" = 10;
