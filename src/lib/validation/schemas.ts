import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().email().max(254),
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().min(10).max(500),
  newPassword: z.string().min(12).max(200),
});

export const createDraftSchema = z.object({
  departmentId: z.string().min(1),
  fiscalYear: z.number().int().min(2000).max(2100),
});

export const updateLineSchema = z.object({
  nextYearTargetExcludingNew: z.string().regex(/^\d+(\.\d{1,2})?$/, "請輸入正確的金額格式"),
  nextYearNewHireBudget: z.string().regex(/^\d+(\.\d{1,2})?$/, "請輸入正確的金額格式"),
});

export const reasonSchema = z.object({
  reason: z.string().trim().min(1, "必須填寫原因").max(2000),
});

export const departmentImportRowSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(100),
  class: z.enum(["P", "R", "S", "M", "UNCLASSIFIED"]),
  notes: z.string().max(500).optional().nullable(),
});

export const accountImportRowSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(100),
  majorCategory: z.enum(["P", "R", "S", "M"]),
  commonCategory: z.enum(["PERSONNEL", "OFFICE", "SG_AND_A", "OTHER"]),
  entryType: z.enum(["FORMULA", "NOT_BUDGETED", "DEPARTMENT_INPUT"]),
  formulaKey: z.string().max(100).optional().nullable(),
});

export const userImportRowSchema = z.object({
  email: z.string().trim().email().max(254),
  name: z.string().trim().min(1).max(100),
  role: z.enum([
    "SYSTEM_ADMIN",
    "BUDGET_OWNER",
    "DEPARTMENT_EDITOR",
    "DEPARTMENT_REVIEWER",
    "FINANCE_REVIEWER",
    "FINANCE_APPROVER",
    "READ_ONLY",
    "AUDITOR",
  ]),
  departmentCode: z.string().max(20).optional().nullable(),
  companyWide: z.boolean().optional().default(false),
});

export const memoryCreateSchema = z.object({
  type: z.enum(["QUERY_PREFERENCE", "FIELD_PREFERENCE", "USER_DRAFT"]),
  scopeDepartmentId: z.string().nullable(),
  fiscalYear: z.number().int().nullable(),
  payload: z.unknown(),
});

export const dualControlRequestSchema = z.object({
  action: z.enum(["UNLOCK_BUDGET", "ROLE_CHANGE", "EXPORT_APPROVED_REPORT", "DELETE_AUDIT_RESTRICTED"]),
  targetEntityType: z.string().min(1),
  targetEntityId: z.string().min(1),
  reason: z.string().trim().min(1).max(2000),
});
