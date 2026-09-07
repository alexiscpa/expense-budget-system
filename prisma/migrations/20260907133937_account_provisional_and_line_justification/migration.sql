-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "isProvisionalCode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priorYearReferenceAmount" DECIMAL(18,2),
ADD COLUMN     "sourceRef" TEXT,
ADD COLUMN     "sourceSeq" INTEGER;

-- AlterTable
ALTER TABLE "BudgetLine" ADD COLUMN     "justification" TEXT;
