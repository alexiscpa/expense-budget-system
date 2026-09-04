import { prisma } from "@/lib/prisma";

/** Truncates all application tables between test cases. Test DB only. */
export async function resetDatabase() {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.memoryEntry.deleteMany(),
    prisma.dualControlRequest.deleteMany(),
    prisma.consistencyCheckRun.deleteMany(),
    prisma.importBatch.deleteMany(),
    prisma.budgetLineMonthlyActual.deleteMany(),
    prisma.budgetLine.deleteMany(),
    prisma.budgetVersion.deleteMany(),
    prisma.salaryDataSource.deleteMany(),
    prisma.formulaDefinition.deleteMany(),
    prisma.account.deleteMany(),
    prisma.passwordResetToken.deleteMany(),
    prisma.loginAttempt.deleteMany(),
    prisma.userDepartmentScope.deleteMany(),
    prisma.user.deleteMany(),
    prisma.department.deleteMany(),
  ]);
}
