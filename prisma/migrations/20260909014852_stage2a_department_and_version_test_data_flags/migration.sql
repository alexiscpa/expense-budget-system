-- AlterTable
ALTER TABLE "BudgetVersion" ADD COLUMN     "isTestData" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "isTestData" BOOLEAN NOT NULL DEFAULT false;
