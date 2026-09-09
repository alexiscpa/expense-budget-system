-- AlterTable
ALTER TABLE "BudgetVersion" ADD COLUMN     "isTestData" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "isTestData" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "DepartmentHeadcount" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "headcount" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "isTestData" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DepartmentHeadcount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DepartmentHeadcount_departmentId_fiscalYear_key" ON "DepartmentHeadcount"("departmentId", "fiscalYear");

-- AddForeignKey
ALTER TABLE "DepartmentHeadcount" ADD CONSTRAINT "DepartmentHeadcount_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
