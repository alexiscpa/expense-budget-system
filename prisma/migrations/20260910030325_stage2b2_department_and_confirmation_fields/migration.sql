-- CreateEnum
CREATE TYPE "DomesticOverseas" AS ENUM ('DOMESTIC', 'OVERSEAS');

-- AlterTable
ALTER TABLE "BudgetLine" ADD COLUMN     "inputConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "inputConfirmedById" TEXT;

-- AlterTable
ALTER TABLE "BudgetVersion" ADD COLUMN     "headcountConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "preparationCompletedAt" TIMESTAMP(3),
ADD COLUMN     "preparationCompletedById" TEXT;

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "domesticOrOverseas" "DomesticOverseas" NOT NULL DEFAULT 'DOMESTIC',
ADD COLUMN     "isBudgetOwner" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "rollupParentCode" TEXT;

-- CreateIndex
CREATE INDEX "BudgetLine_inputConfirmedAt_idx" ON "BudgetLine"("inputConfirmedAt");

-- AddForeignKey
ALTER TABLE "BudgetVersion" ADD CONSTRAINT "BudgetVersion_preparationCompletedById_fkey" FOREIGN KEY ("preparationCompletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_inputConfirmedById_fkey" FOREIGN KEY ("inputConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data backfill for the 9 pre-existing departments' rollupParentCode and
-- domesticOrOverseas, sourced verbatim from
-- docs/data/stage2b1-department-manifest.json (never guessed from the
-- code/name). All 9 default to DOMESTIC correctly except 20001 GWK, which
-- is explicitly overseas. This does not touch any BudgetVersion/BudgetLine/
-- AuditLog row and does not create or delete any Department row.
UPDATE "Department" SET "rollupParentCode" = '17003' WHERE "code" IN ('17103', '17203', '17303');
UPDATE "Department" SET "rollupParentCode" = '12101' WHERE "code" = '12111';
UPDATE "Department" SET "rollupParentCode" = '11102' WHERE "code" = '11122';
UPDATE "Department" SET "rollupParentCode" = '11302' WHERE "code" = '11322';
UPDATE "Department" SET "rollupParentCode" = '16104' WHERE "code" = '16124';
UPDATE "Department" SET "rollupParentCode" = '16004' WHERE "code" = '16204';
UPDATE "Department" SET "domesticOrOverseas" = 'OVERSEAS' WHERE "code" = '20001';
