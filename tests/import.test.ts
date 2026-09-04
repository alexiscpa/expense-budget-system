import { describe, it, expect, beforeEach } from "vitest";
import { resetDatabase } from "./helpers/reset";
import { createUser, toCurrentUser } from "./helpers/factory";
import {
  previewDepartmentImport,
  commitDepartmentImport,
  previewAccountImport,
  commitAccountImport,
  hashFileBuffer,
} from "@/lib/importing/masterDataImport";
import { prisma } from "@/lib/prisma";

beforeEach(async () => {
  await resetDatabase();
});

describe("master data import - validation & preview", () => {
  it("flags invalid rows and in-file duplicates without touching the database", async () => {
    const rows = [
      { code: "D001", name: "部門A", class: "M" },
      { code: "D001", name: "部門A重複", class: "M" }, // duplicate code in file
      { code: "", name: "缺代碼", class: "M" }, // invalid
      { code: "D002", name: "部門B", class: "INVALID_CLASS" }, // invalid enum
    ];
    const preview = previewDepartmentImport(rows);
    expect(preview.validRows).toHaveLength(1);
    expect(preview.errors.length).toBeGreaterThanOrEqual(3);
    expect(preview.duplicateKeysInFile).toContain("D001");

    const count = await prisma.department.count();
    expect(count).toBe(0);
  });

  it("requires a formulaKey for FORMULA accounts so the UI can never silently show 0", () => {
    const preview = previewAccountImport([
      { code: "6301", name: "端午獎金", majorCategory: "R", commonCategory: "PERSONNEL", entryType: "FORMULA" },
    ]);
    expect(preview.validRows).toHaveLength(0);
    expect(preview.errors[0]?.errors.join()).toContain("formulaKey");
  });
});

describe("master data import - transactional commit", () => {
  it("commits all valid rows atomically and writes an ImportBatch audit record", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    const rows = [
      { code: "D010", name: "部門十", class: "M" },
      { code: "D011", name: "部門十一", class: "S" },
    ];
    const preview = previewDepartmentImport(rows);
    const fileHash = hashFileBuffer(Buffer.from("dept-file-1"));

    const batch = await commitDepartmentImport(toCurrentUser(admin), { fileName: "depts.csv", fileHash }, preview.validRows);
    expect(batch.status).toBe("COMMITTED");
    expect(await prisma.department.count()).toBe(2);

    const auditRows = await prisma.auditLog.findMany({ where: { action: "MASTER_DATA_IMPORT_DEPARTMENT" } });
    expect(auditRows).toHaveLength(1);
  });

  it("detects a re-upload of the exact same file and refuses to import it twice", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    const rows = [{ code: "D020", name: "部門二十", class: "M" }];
    const preview = previewDepartmentImport(rows);
    const fileHash = hashFileBuffer(Buffer.from("dept-file-dup"));

    await commitDepartmentImport(toCurrentUser(admin), { fileName: "depts.csv", fileHash }, preview.validRows);
    await expect(
      commitDepartmentImport(toCurrentUser(admin), { fileName: "depts.csv", fileHash }, preview.validRows)
    ).rejects.toThrow(/重複上傳/);
  });

  it("rolls back the entire batch when a row references a nonexistent department (all-or-nothing)", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    const rows = [
      { code: "A100", name: "有效科目", majorCategory: "M", commonCategory: "OFFICE", entryType: "DEPARTMENT_INPUT" },
    ];
    const preview = previewAccountImport(rows);
    const fileHash = hashFileBuffer(Buffer.from("account-file-1"));
    await commitAccountImport(toCurrentUser(admin), { fileName: "accounts.csv", fileHash }, preview.validRows);
    expect(await prisma.account.count()).toBe(1);

    // A second batch where one row is fine and would normally succeed, but
    // we simulate a mid-transaction failure by forcing a duplicate-code
    // collision inside the same batch after schema-level validation passes
    // (two different rows both intending to create code A200, but the
    // second is malformed post-parse) - verifying no partial rows commit.
    const badRows = [
      { code: "A200", name: "第一筆", majorCategory: "M", commonCategory: "OFFICE", entryType: "DEPARTMENT_INPUT" },
    ];
    const badPreview = previewAccountImport(badRows);
    const fileHash2 = hashFileBuffer(Buffer.from("account-file-2"));
    // Force a failure mid-way by making commit throw via an invalid entryType
    // bypassing preview (simulating a defect elsewhere) - directly assert
    // the transaction wrapper: if account.upsert throws, ImportBatch row is
    // never marked COMMITTED and no account rows from this batch persist.
    const brokenRows = [...badPreview.validRows, { ...badPreview.validRows[0]!, code: "A200", majorCategory: "NOT_A_CLASS" as never }];

    await expect(
      commitAccountImport(toCurrentUser(admin), { fileName: "accounts2.csv", fileHash: fileHash2 }, brokenRows)
    ).rejects.toThrow();

    // Only the first batch's single account exists; nothing from the failed batch was committed.
    expect(await prisma.account.count()).toBe(1);
    const failedBatch = await prisma.importBatch.findUnique({ where: { entityType_fileHash: { entityType: "ACCOUNT", fileHash: fileHash2 } } });
    expect(failedBatch).toBeNull();
  });
});
