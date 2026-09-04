import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "@/lib/auth/session";
import { requireCapability, ApiError } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/log";
import {
  departmentImportRowSchema,
  accountImportRowSchema,
  userImportRowSchema,
} from "@/lib/validation/schemas";
import { hashPassword } from "@/lib/auth/password";
import type { ImportEntityType } from "@prisma/client";

export const TEMPLATE_VERSIONS: Record<ImportEntityType, string> = {
  DEPARTMENT: "dept-v1",
  ACCOUNT: "account-v1",
  USER: "user-v1",
  BUDGET_LINES: "budget-line-v1",
};

export interface RowError {
  row: number;
  errors: string[];
}

export interface ImportPreview<T> {
  totalRows: number;
  validRows: T[];
  errors: RowError[];
  duplicateKeysInFile: string[];
}

export function hashFileBuffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export async function assertNotDuplicateUpload(entityType: ImportEntityType, fileHash: string) {
  const existing = await prisma.importBatch.findUnique({
    where: { entityType_fileHash: { entityType, fileHash } },
  });
  if (existing && existing.status === "COMMITTED") {
    throw new ApiError(409, `此檔案先前已於 ${existing.createdAt.toISOString()} 匯入成功（批次 ${existing.id}），偵測到重複上傳`);
  }
}

// --- Departments ------------------------------------------------------

export function previewDepartmentImport(rows: unknown[]): ImportPreview<{
  code: string;
  name: string;
  class: string;
  notes?: string | null;
}> {
  const errors: RowError[] = [];
  const valid: { code: string; name: string; class: string; notes?: string | null }[] = [];
  const seen = new Set<string>();
  const duplicateKeysInFile: string[] = [];

  rows.forEach((row, idx) => {
    const parsed = departmentImportRowSchema.safeParse(row);
    if (!parsed.success) {
      errors.push({ row: idx + 1, errors: parsed.error.issues.map((i) => i.message) });
      return;
    }
    if (seen.has(parsed.data.code)) {
      duplicateKeysInFile.push(parsed.data.code);
      errors.push({ row: idx + 1, errors: [`部門代碼 ${parsed.data.code} 於檔案中重複`] });
      return;
    }
    seen.add(parsed.data.code);
    valid.push(parsed.data);
  });

  return { totalRows: rows.length, validRows: valid, errors, duplicateKeysInFile };
}

export async function commitDepartmentImport(
  user: CurrentUser,
  batchMeta: { fileName: string; fileHash: string },
  rows: { code: string; name: string; class: string; notes?: string | null }[]
) {
  await requireCapability(user, "master_data.import");
  await assertNotDuplicateUpload("DEPARTMENT", batchMeta.fileHash);

  return prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.create({
      data: {
        entityType: "DEPARTMENT",
        fileName: batchMeta.fileName,
        fileHash: batchMeta.fileHash,
        templateVersion: TEMPLATE_VERSIONS.DEPARTMENT,
        uploadedById: user.id,
        status: "PENDING",
        totalRows: rows.length,
      },
    });

    for (const row of rows) {
      await tx.department.upsert({
        where: { code: row.code },
        update: { name: row.name, class: row.class as never, notes: row.notes ?? null },
        create: { code: row.code, name: row.name, class: row.class as never, notes: row.notes ?? null },
      });
    }

    const committed = await tx.importBatch.update({
      where: { id: batch.id },
      data: { status: "COMMITTED", successRows: rows.length, committedAt: new Date() },
    });

    await writeAuditLog(
      {
        actorUserId: user.id,
        action: "MASTER_DATA_IMPORT_DEPARTMENT",
        entityType: "ImportBatch",
        entityId: batch.id,
        afterData: { rowCount: rows.length },
      },
      tx
    );

    return committed;
  });
}

// --- Accounts -----------------------------------------------------------

export function previewAccountImport(rows: unknown[]): ImportPreview<{
  code: string;
  name: string;
  majorCategory: string;
  commonCategory: string;
  entryType: string;
  formulaKey?: string | null;
}> {
  const errors: RowError[] = [];
  const valid: {
    code: string;
    name: string;
    majorCategory: string;
    commonCategory: string;
    entryType: string;
    formulaKey?: string | null;
  }[] = [];
  const seen = new Set<string>();
  const duplicateKeysInFile: string[] = [];

  rows.forEach((row, idx) => {
    const parsed = accountImportRowSchema.safeParse(row);
    if (!parsed.success) {
      errors.push({ row: idx + 1, errors: parsed.error.issues.map((i) => i.message) });
      return;
    }
    if (parsed.data.entryType === "FORMULA" && !parsed.data.formulaKey) {
      errors.push({ row: idx + 1, errors: ["公式科目必須指定 formulaKey，否則畫面將永遠顯示尚未設定"] });
      return;
    }
    if (seen.has(parsed.data.code)) {
      duplicateKeysInFile.push(parsed.data.code);
      errors.push({ row: idx + 1, errors: [`科目編號 ${parsed.data.code} 於檔案中重複`] });
      return;
    }
    seen.add(parsed.data.code);
    valid.push(parsed.data);
  });

  return { totalRows: rows.length, validRows: valid, errors, duplicateKeysInFile };
}

export async function commitAccountImport(
  user: CurrentUser,
  batchMeta: { fileName: string; fileHash: string },
  rows: {
    code: string;
    name: string;
    majorCategory: string;
    commonCategory: string;
    entryType: string;
    formulaKey?: string | null;
  }[]
) {
  await requireCapability(user, "master_data.import");
  await assertNotDuplicateUpload("ACCOUNT", batchMeta.fileHash);

  return prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.create({
      data: {
        entityType: "ACCOUNT",
        fileName: batchMeta.fileName,
        fileHash: batchMeta.fileHash,
        templateVersion: TEMPLATE_VERSIONS.ACCOUNT,
        uploadedById: user.id,
        status: "PENDING",
        totalRows: rows.length,
      },
    });

    for (const row of rows) {
      await tx.account.upsert({
        where: { code: row.code },
        update: {
          name: row.name,
          majorCategory: row.majorCategory as never,
          commonCategory: row.commonCategory as never,
          entryType: row.entryType as never,
          formulaKey: row.formulaKey ?? null,
        },
        create: {
          code: row.code,
          name: row.name,
          majorCategory: row.majorCategory as never,
          commonCategory: row.commonCategory as never,
          entryType: row.entryType as never,
          formulaKey: row.formulaKey ?? null,
        },
      });
    }

    const committed = await tx.importBatch.update({
      where: { id: batch.id },
      data: { status: "COMMITTED", successRows: rows.length, committedAt: new Date() },
    });

    await writeAuditLog(
      {
        actorUserId: user.id,
        action: "MASTER_DATA_IMPORT_ACCOUNT",
        entityType: "ImportBatch",
        entityId: batch.id,
        afterData: { rowCount: rows.length },
      },
      tx
    );

    return committed;
  });
}

// --- Users ----------------------------------------------------------------

export function previewUserImport(rows: unknown[]): ImportPreview<{
  email: string;
  name: string;
  role: string;
  departmentCode?: string | null;
  companyWide?: boolean;
}> {
  const errors: RowError[] = [];
  const valid: {
    email: string;
    name: string;
    role: string;
    departmentCode?: string | null;
    companyWide?: boolean;
  }[] = [];
  const seen = new Set<string>();
  const duplicateKeysInFile: string[] = [];

  rows.forEach((row, idx) => {
    const parsed = userImportRowSchema.safeParse(row);
    if (!parsed.success) {
      errors.push({ row: idx + 1, errors: parsed.error.issues.map((i) => i.message) });
      return;
    }
    const isDeptScoped = ["BUDGET_OWNER", "DEPARTMENT_EDITOR", "DEPARTMENT_REVIEWER"].includes(parsed.data.role);
    if (isDeptScoped && !parsed.data.departmentCode) {
      errors.push({ row: idx + 1, errors: ["部門角色必須指定 departmentCode"] });
      return;
    }
    const key = parsed.data.email.toLowerCase();
    if (seen.has(key)) {
      duplicateKeysInFile.push(key);
      errors.push({ row: idx + 1, errors: [`Email ${parsed.data.email} 於檔案中重複`] });
      return;
    }
    seen.add(key);
    valid.push(parsed.data);
  });

  return { totalRows: rows.length, validRows: valid, errors, duplicateKeysInFile };
}

export interface UserImportResult {
  email: string;
  resetToken: string;
}

export async function commitUserImport(
  user: CurrentUser,
  batchMeta: { fileName: string; fileHash: string },
  rows: { email: string; name: string; role: string; departmentCode?: string | null; companyWide?: boolean }[]
): Promise<{ batchId: string; results: UserImportResult[] }> {
  await requireCapability(user, "user.manage");
  await assertNotDuplicateUpload("USER", batchMeta.fileHash);

  const results: UserImportResult[] = [];

  const batch = await prisma.$transaction(async (tx) => {
    const importBatch = await tx.importBatch.create({
      data: {
        entityType: "USER",
        fileName: batchMeta.fileName,
        fileHash: batchMeta.fileHash,
        templateVersion: TEMPLATE_VERSIONS.USER,
        uploadedById: user.id,
        status: "PENDING",
        totalRows: rows.length,
      },
    });

    for (const row of rows) {
      let departmentId: string | null = null;
      if (row.departmentCode) {
        const dept = await tx.department.findUnique({ where: { code: row.departmentCode } });
        if (!dept) throw new ApiError(422, `找不到部門代碼 ${row.departmentCode}`);
        departmentId = dept.id;
      }

      // Imported accounts never receive a usable, admin-known password.
      // A random value is hashed and discarded; the user must complete a
      // password-reset flow to set their own credential.
      const throwaway = crypto.randomBytes(32).toString("hex");
      const passwordHash = await hashPassword(throwaway);

      const created = await tx.user.upsert({
        where: { email: row.email.toLowerCase() },
        update: { name: row.name, role: row.role as never, companyWide: row.companyWide ?? false },
        create: {
          email: row.email.toLowerCase(),
          name: row.name,
          role: row.role as never,
          companyWide: row.companyWide ?? false,
          passwordHash,
          mustResetPassword: true,
        },
      });

      if (departmentId) {
        await tx.userDepartmentScope.upsert({
          where: { userId_departmentId: { userId: created.id, departmentId } },
          update: {},
          create: { userId: created.id, departmentId },
        });
      }

      const resetToken = crypto.randomBytes(32).toString("base64url");
      const resetHash = crypto.createHash("sha256").update(resetToken).digest("hex");
      await tx.passwordResetToken.create({
        data: {
          userId: created.id,
          tokenHash: resetHash,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 3),
        },
      });

      results.push({ email: created.email, resetToken });
    }

    const committed = await tx.importBatch.update({
      where: { id: importBatch.id },
      data: { status: "COMMITTED", successRows: rows.length, committedAt: new Date() },
    });

    await writeAuditLog(
      {
        actorUserId: user.id,
        action: "MASTER_DATA_IMPORT_USER",
        entityType: "ImportBatch",
        entityId: importBatch.id,
        afterData: { rowCount: rows.length, emails: rows.map((r) => r.email) },
      },
      tx
    );

    return committed;
  });

  return { batchId: batch.id, results };
}
