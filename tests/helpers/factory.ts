import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import type { CurrentUser } from "@/lib/auth/session";
import type { Role } from "@prisma/client";

let counter = 0;
function uniq(prefix: string) {
  counter += 1;
  return `${prefix}${counter}`;
}

export async function createDepartment(overrides: Partial<{ code: string; name: string; class: "P" | "R" | "S" | "M" | "UNCLASSIFIED" }> = {}) {
  return prisma.department.create({
    data: {
      code: overrides.code ?? uniq("DEPT"),
      name: overrides.name ?? "測試部門",
      class: overrides.class ?? "M",
    },
  });
}

export async function createUser(overrides: Partial<{ email: string; role: Role; companyWide: boolean; name: string }> = {}) {
  const passwordHash = await hashPassword("Test-Password-1234!");
  return prisma.user.create({
    data: {
      email: overrides.email ?? `${uniq("user")}@example.com`,
      name: overrides.name ?? "Test User",
      role: overrides.role ?? "READ_ONLY",
      companyWide: overrides.companyWide ?? false,
      passwordHash,
    },
  });
}

export function toCurrentUser(user: { id: string; email: string; name: string; role: Role; companyWide: boolean; isActive: boolean }): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    companyWide: user.companyWide,
    isActive: user.isActive,
  };
}

export async function grantDepartmentScope(userId: string, departmentId: string) {
  return prisma.userDepartmentScope.create({ data: { userId, departmentId } });
}

export async function createAccount(
  overrides: Partial<{
    code: string;
    name: string;
    majorCategory: "P" | "R" | "S" | "M" | "UNCLASSIFIED";
    commonCategory: "PERSONNEL" | "OFFICE" | "SG_AND_A" | "OTHER";
    entryType: "FORMULA" | "NOT_BUDGETED" | "DEPARTMENT_INPUT";
    formulaKey: string | null;
  }> = {}
) {
  return prisma.account.create({
    data: {
      code: overrides.code ?? uniq("ACCT"),
      name: overrides.name ?? "測試科目",
      majorCategory: overrides.majorCategory ?? "M",
      commonCategory: overrides.commonCategory ?? "OFFICE",
      entryType: overrides.entryType ?? "DEPARTMENT_INPUT",
      formulaKey: overrides.formulaKey ?? null,
    },
  });
}
