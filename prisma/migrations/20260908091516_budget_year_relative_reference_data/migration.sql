-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "priorYearReferenceFiscalYear" INTEGER;

-- AlterTable
ALTER TABLE "BudgetVersion" ALTER COLUMN "priorYearHeadcount" DROP NOT NULL,
ALTER COLUMN "priorYearHeadcount" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "priorYearReferenceFiscalYear" INTEGER;

-- ---------------------------------------------------------------------------
-- Data migration: stamp the fiscal year every existing prior-year reference
-- figure actually represents, then correct any already-created BudgetVersion
-- whose reference fields were seeded under the old (year-unaware) logic for
-- a fiscal year that reference does NOT match.
--
-- Background: every prior-year reference figure currently in this database
-- (Account.priorYearReferenceAmount, Department.priorYearHeadcount) was
-- imported from the real "2026年度費用預算V2--財務.xlsx" spreadsheet's
-- "2025推移" column - i.e. it represents 2025, and only 2025, regardless of
-- which fiscal year a BudgetVersion draft happens to be created for. Before
-- this migration, createBudgetVersionDraft copied this figure into any new
-- draft's read-only reference fields unconditionally, so a draft created for
-- fiscalYear=2027 (fiscalYear-1=2026) ended up silently displaying the 2025
-- figure mislabeled as "2026推估" - exactly the bug this migration and its
-- accompanying code changes (lib/budget/lineService.ts) fix.
--
-- Existing budget retention: this migration deletes no BudgetVersion/
-- BudgetLine row and never touches any user-entered field (BudgetLine.
-- nextYearTargetExcludingNew/nextYearNewHireBudget/nextYearTotal/
-- justification, BudgetVersion.budgetYearHeadcount, status, workflow
-- timestamps). It only corrects the read-only prior-year reference columns
-- on versions whose fiscalYear-1 does not equal 2025 (the one year with a
-- real, confirmed reference in this system today) back to "not yet
-- available" - the same state a brand-new draft for that fiscal year would
-- get under the fixed logic.
-- ---------------------------------------------------------------------------

-- 1. Backfill: every account/department that currently holds a prior-year
--    reference figure had it imported from the spreadsheet's 2025 column.
UPDATE "Account"
SET "priorYearReferenceFiscalYear" = 2025
WHERE "priorYearReferenceAmount" IS NOT NULL
  AND "priorYearReferenceFiscalYear" IS NULL;

UPDATE "Department"
SET "priorYearReferenceFiscalYear" = 2025
WHERE "priorYearHeadcount" IS NOT NULL
  AND "priorYearReferenceFiscalYear" IS NULL;

-- 2. Correct existing BudgetLine rows on any BudgetVersion whose fiscalYear
--    is NOT 2026 (so fiscalYear-1 <> 2025, the only year with a real
--    reference) that were seeded under the old year-unaware logic. Resets
--    exactly the read-only reference fields to "not yet available";
--    nextYear*/justification are untouched.
UPDATE "BudgetLine" bl
SET "priorYearOriginalBudget" = 0,
    "currentYearProjection" = NULL,
    "projectionIsComplete" = false,
    "growthRateExcludingNew" = NULL,
    "growthRateIncludingNew" = NULL
FROM "BudgetVersion" bv
WHERE bl."budgetVersionId" = bv."id"
  AND bv."fiscalYear" <> 2026
  AND bl."projectionIsComplete" = true;

-- 3. Same correction for BudgetVersion.priorYearHeadcount.
UPDATE "BudgetVersion"
SET "priorYearHeadcount" = NULL
WHERE "fiscalYear" <> 2026
  AND "priorYearHeadcount" IS NOT NULL;
