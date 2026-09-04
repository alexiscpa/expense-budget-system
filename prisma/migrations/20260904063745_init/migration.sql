-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SYSTEM_ADMIN', 'BUDGET_OWNER', 'DEPARTMENT_EDITOR', 'DEPARTMENT_REVIEWER', 'FINANCE_REVIEWER', 'FINANCE_APPROVER', 'READ_ONLY', 'AUDITOR');

-- CreateEnum
CREATE TYPE "DeptClass" AS ENUM ('P', 'R', 'S', 'M', 'UNCLASSIFIED');

-- CreateEnum
CREATE TYPE "AccountEntryType" AS ENUM ('FORMULA', 'NOT_BUDGETED', 'DEPARTMENT_INPUT');

-- CreateEnum
CREATE TYPE "AccountCommonCategory" AS ENUM ('PERSONNEL', 'OFFICE', 'SG_AND_A', 'OTHER');

-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'RETURNED', 'APPROVED', 'LOCKED', 'ADJUSTMENT_PENDING', 'ADJUSTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FormulaStatus" AS ENUM ('NOT_APPLICABLE', 'CONFIGURED', 'NOT_CONFIGURED');

-- CreateEnum
CREATE TYPE "ImportEntityType" AS ENUM ('ACCOUNT', 'DEPARTMENT', 'USER', 'BUDGET_LINES');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('PENDING', 'VALIDATED', 'FAILED', 'COMMITTED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "MemoryType" AS ENUM ('PRIOR_YEAR_APPROVED_BUDGET', 'PRIOR_YEAR_ACTUAL', 'SUBMISSION_VERSION', 'USER_DRAFT', 'RETURN_REASON', 'MANUAL_ADJUSTMENT', 'QUERY_PREFERENCE', 'FIELD_PREFERENCE', 'PERIOD_VARIANCE', 'AMOUNT_PERCENT_VARIANCE');

-- CreateEnum
CREATE TYPE "DualControlAction" AS ENUM ('UNLOCK_BUDGET', 'ROLE_CHANGE', 'EXPORT_APPROVED_REPORT', 'DELETE_AUDIT_RESTRICTED');

-- CreateEnum
CREATE TYPE "DualControlStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "companyWide" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "mustResetPassword" BOOLEAN NOT NULL DEFAULT false,
    "ssoSubject" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserDepartmentScope" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserDepartmentScope_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "class" "DeptClass" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "majorCategory" "DeptClass" NOT NULL,
    "commonCategory" "AccountCommonCategory" NOT NULL,
    "entryType" "AccountEntryType" NOT NULL,
    "formulaKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormulaDefinition" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "expression" JSONB NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormulaDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryDataSource" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "totalBaseSalary" DECIMAL(18,2) NOT NULL,
    "employeeCount" INTEGER NOT NULL,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryDataSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetVersion" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "BudgetStatus" NOT NULL DEFAULT 'DRAFT',
    "parentVersionId" TEXT,
    "preparedById" TEXT,
    "submittedById" TEXT,
    "reviewedById" TEXT,
    "approvedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewStartedAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "returnReason" TEXT,
    "approvedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "adjustmentReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLine" (
    "id" TEXT NOT NULL,
    "budgetVersionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "priorPriorYearActual" DECIMAL(18,2) NOT NULL,
    "priorYearOriginalBudget" DECIMAL(18,2) NOT NULL,
    "currentYearProjection" DECIMAL(18,2),
    "projectionIsComplete" BOOLEAN NOT NULL DEFAULT false,
    "nextYearTargetExcludingNew" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "nextYearNewHireBudget" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "nextYearTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "growthRateExcludingNew" DECIMAL(9,4),
    "growthRateIncludingNew" DECIMAL(9,4),
    "entryTypeSnapshot" "AccountEntryType" NOT NULL,
    "formulaStatus" "FormulaStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetLineMonthlyActual" (
    "id" TEXT NOT NULL,
    "budgetLineId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "amount" DECIMAL(18,2),
    "isMissing" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetLineMonthlyActual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsistencyCheckRun" (
    "id" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "departmentTotal" DECIMAL(18,2) NOT NULL,
    "accountTotal" DECIMAL(18,2) NOT NULL,
    "difference" DECIMAL(18,2) NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "detail" JSONB NOT NULL,
    "runByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsistencyCheckRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "entityType" "ImportEntityType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "templateVersion" TEXT NOT NULL,
    "fiscalYear" INTEGER,
    "uploadedById" TEXT NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'PENDING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "successRows" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errorReport" JSONB,
    "committedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "reason" TEXT,
    "beforeData" JSONB,
    "afterData" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryEntry" (
    "id" TEXT NOT NULL,
    "type" "MemoryType" NOT NULL,
    "scopeDepartmentId" TEXT,
    "fiscalYear" INTEGER,
    "source" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isUserDeletable" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "aiSuggested" BOOLEAN NOT NULL DEFAULT false,
    "aiConfirmedById" TEXT,
    "aiConfirmedAt" TIMESTAMP(3),
    "overrideReason" TEXT,

    CONSTRAINT "MemoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DualControlRequest" (
    "id" TEXT NOT NULL,
    "action" "DualControlAction" NOT NULL,
    "targetEntityType" TEXT NOT NULL,
    "targetEntityId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "payload" JSONB,
    "status" "DualControlStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DualControlRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_ssoSubject_key" ON "User"("ssoSubject");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "UserDepartmentScope_userId_departmentId_key" ON "UserDepartmentScope"("userId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "LoginAttempt_email_createdAt_idx" ON "LoginAttempt"("email", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE INDEX "Department_class_idx" ON "Department"("class");

-- CreateIndex
CREATE UNIQUE INDEX "Account_code_key" ON "Account"("code");

-- CreateIndex
CREATE INDEX "Account_majorCategory_idx" ON "Account"("majorCategory");

-- CreateIndex
CREATE INDEX "Account_entryType_idx" ON "Account"("entryType");

-- CreateIndex
CREATE INDEX "FormulaDefinition_key_isActive_idx" ON "FormulaDefinition"("key", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "FormulaDefinition_key_version_key" ON "FormulaDefinition"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryDataSource_departmentId_fiscalYear_month_key" ON "SalaryDataSource"("departmentId", "fiscalYear", "month");

-- CreateIndex
CREATE INDEX "BudgetVersion_departmentId_fiscalYear_idx" ON "BudgetVersion"("departmentId", "fiscalYear");

-- CreateIndex
CREATE INDEX "BudgetVersion_status_idx" ON "BudgetVersion"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetVersion_departmentId_fiscalYear_versionNumber_key" ON "BudgetVersion"("departmentId", "fiscalYear", "versionNumber");

-- CreateIndex
CREATE INDEX "BudgetLine_formulaStatus_idx" ON "BudgetLine"("formulaStatus");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetLine_budgetVersionId_accountId_key" ON "BudgetLine"("budgetVersionId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetLineMonthlyActual_budgetLineId_year_month_key" ON "BudgetLineMonthlyActual"("budgetLineId", "year", "month");

-- CreateIndex
CREATE INDEX "ConsistencyCheckRun_fiscalYear_idx" ON "ConsistencyCheckRun"("fiscalYear");

-- CreateIndex
CREATE INDEX "ImportBatch_entityType_status_idx" ON "ImportBatch"("entityType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_entityType_fileHash_key" ON "ImportBatch"("entityType", "fileHash");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_idx" ON "AuditLog"("actorUserId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "MemoryEntry_type_scopeDepartmentId_fiscalYear_idx" ON "MemoryEntry"("type", "scopeDepartmentId", "fiscalYear");

-- CreateIndex
CREATE INDEX "MemoryEntry_createdById_idx" ON "MemoryEntry"("createdById");

-- CreateIndex
CREATE INDEX "DualControlRequest_status_idx" ON "DualControlRequest"("status");

-- CreateIndex
CREATE INDEX "DualControlRequest_targetEntityType_targetEntityId_idx" ON "DualControlRequest"("targetEntityType", "targetEntityId");

-- AddForeignKey
ALTER TABLE "UserDepartmentScope" ADD CONSTRAINT "UserDepartmentScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserDepartmentScope" ADD CONSTRAINT "UserDepartmentScope_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryDataSource" ADD CONSTRAINT "SalaryDataSource_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetVersion" ADD CONSTRAINT "BudgetVersion_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "BudgetVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetVersion" ADD CONSTRAINT "BudgetVersion_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetVersion" ADD CONSTRAINT "BudgetVersion_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetVersion" ADD CONSTRAINT "BudgetVersion_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetVersion" ADD CONSTRAINT "BudgetVersion_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetVersion" ADD CONSTRAINT "BudgetVersion_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_budgetVersionId_fkey" FOREIGN KEY ("budgetVersionId") REFERENCES "BudgetVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLine" ADD CONSTRAINT "BudgetLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetLineMonthlyActual" ADD CONSTRAINT "BudgetLineMonthlyActual_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "BudgetLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEntry" ADD CONSTRAINT "MemoryEntry_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEntry" ADD CONSTRAINT "MemoryEntry_aiConfirmedById_fkey" FOREIGN KEY ("aiConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryEntry" ADD CONSTRAINT "MemoryEntry_scopeDepartmentId_fkey" FOREIGN KEY ("scopeDepartmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DualControlRequest" ADD CONSTRAINT "DualControlRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DualControlRequest" ADD CONSTRAINT "DualControlRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
