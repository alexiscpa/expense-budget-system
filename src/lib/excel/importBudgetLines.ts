import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { Decimal, isNegative } from "@/lib/money/decimal";
import type { CurrentUser } from "@/lib/auth/session";
import { requireCapability, requireDepartmentAccess, ApiError } from "@/lib/rbac/guard";
import { isEditable } from "@/lib/workflow/stateMachine";
import { deriveLineTotals } from "@/lib/budget/lineService";
import { writeAuditLog } from "@/lib/audit/log";
import { isFormulaCell } from "@/lib/excel/sanitize";
import { assertNotDuplicateUpload, hashFileBuffer, TEMPLATE_VERSIONS } from "@/lib/importing/masterDataImport";

// Column order is fixed and checked exactly - an unexpected layout is
// reported back as a "格式不符清單" rather than guessed at, per
// docs/budget-system-spec-v0.4.md §1.4 failure-handling note.
export const BUDGET_LINE_TEMPLATE_HEADERS = [
  "科目編號",
  "序",
  "項目",
  "前前年度實績",
  "前一年度目標",
  "本年度推移",
  "次年度目標不含新員",
  "次年度目標新員",
] as const;

export interface BudgetLineImportRow {
  accountCode: string;
  seq: string;
  itemName: string;
  priorPriorYearActual: string;
  priorYearOriginalBudget: string;
  currentYearProjection: string | null;
  nextYearTargetExcludingNew: string;
  nextYearNewHireBudget: string;
}

export interface BudgetLineRowError {
  row: number;
  errors: string[];
}

export interface BudgetLineImportPreview {
  headerMatches: boolean;
  headerFound: string[];
  totalRows: number;
  validRows: (BudgetLineImportRow & { row: number })[];
  errors: BudgetLineRowError[];
}

export async function parseBudgetLineWorkbook(buffer: Buffer): Promise<BudgetLineImportPreview> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    return { headerMatches: false, headerFound: [], totalRows: 0, validRows: [], errors: [] };
  }

  const headerRow = sheet.getRow(1);
  const headerFound: string[] = [];
  for (let col = 1; col <= BUDGET_LINE_TEMPLATE_HEADERS.length; col++) {
    headerFound.push(String(headerRow.getCell(col).value ?? "").trim());
  }
  const headerMatches = BUDGET_LINE_TEMPLATE_HEADERS.every((h, i) => headerFound[i] === h);
  if (!headerMatches) {
    return { headerMatches: false, headerFound, totalRows: 0, validRows: [], errors: [] };
  }

  const validRows: (BudgetLineImportRow & { row: number })[] = [];
  const errors: BudgetLineRowError[] = [];

  for (let rowNum = 2; rowNum <= sheet.rowCount; rowNum++) {
    const row = sheet.getRow(rowNum);
    if (row.cellCount === 0 || row.getCell(1).value === null) continue;

    const rowErrors: string[] = [];
    for (let col = 1; col <= BUDGET_LINE_TEMPLATE_HEADERS.length; col++) {
      if (isFormulaCell(row.getCell(col).value)) {
        rowErrors.push(`第 ${col} 欄不可為公式，僅接受純值`);
      }
    }

    const accountCode = String(row.getCell(1).value ?? "").trim();
    const amountFields = [4, 5, 7, 8];
    for (const col of amountFields) {
      const raw = row.getCell(col).value;
      if (raw !== null && raw !== undefined && raw !== "" && isNaN(Number(raw))) {
        rowErrors.push(`第 ${col} 欄金額格式錯誤`);
      }
    }
    if (!accountCode) rowErrors.push("科目編號為必填");

    if (rowErrors.length > 0) {
      errors.push({ row: rowNum, errors: rowErrors });
      continue;
    }

    validRows.push({
      row: rowNum,
      accountCode,
      seq: String(row.getCell(2).value ?? ""),
      itemName: String(row.getCell(3).value ?? ""),
      priorPriorYearActual: String(row.getCell(4).value ?? "0"),
      priorYearOriginalBudget: String(row.getCell(5).value ?? "0"),
      currentYearProjection: row.getCell(6).value === null ? null : String(row.getCell(6).value),
      nextYearTargetExcludingNew: String(row.getCell(7).value ?? "0"),
      nextYearNewHireBudget: String(row.getCell(8).value ?? "0"),
    });
  }

  return { headerMatches: true, headerFound, totalRows: sheet.rowCount - 1, validRows, errors };
}

export async function commitBudgetLineImport(
  user: CurrentUser,
  versionId: string,
  fileMeta: { fileName: string; buffer: Buffer },
  rows: BudgetLineImportRow[]
) {
  await requireCapability(user, "budget.edit_own_department");

  const fileHash = hashFileBuffer(fileMeta.buffer);
  await assertNotDuplicateUpload("BUDGET_LINES", fileHash);

  return prisma.$transaction(async (tx) => {
    const version = await tx.budgetVersion.findUnique({ where: { id: versionId }, include: { lines: true } });
    if (!version) throw new ApiError(404, "找不到此預算版本");
    await requireDepartmentAccess(user, version.departmentId);
    if (!isEditable(version.status)) {
      throw new ApiError(409, "此預算版本目前不可匯入修改");
    }

    const batch = await tx.importBatch.create({
      data: {
        entityType: "BUDGET_LINES",
        fileName: fileMeta.fileName,
        fileHash,
        templateVersion: TEMPLATE_VERSIONS.BUDGET_LINES,
        fiscalYear: version.fiscalYear,
        uploadedById: user.id,
        status: "PENDING",
        totalRows: rows.length,
      },
    });

    const errorReport: { row: number; message: string }[] = [];
    let successRows = 0;

    for (const row of rows) {
      const account = await tx.account.findUnique({ where: { code: row.accountCode } });
      if (!account) {
        errorReport.push({ row: 0, message: `找不到科目編號 ${row.accountCode}` });
        continue;
      }
      const line = version.lines.find((l) => l.accountId === account.id);
      if (!line) {
        errorReport.push({ row: 0, message: `此預算版本中無科目 ${row.accountCode} 的資料列` });
        continue;
      }

      if (line.isLocked) {
        // Locked (FORMULA / NOT_BUDGETED) lines are never overwritten by an
        // import - only the system/formula engine may set their value.
        continue;
      }

      const excludingNew = new Decimal(row.nextYearTargetExcludingNew || "0");
      const newHire = new Decimal(row.nextYearNewHireBudget || "0");
      if (isNegative(excludingNew) || isNegative(newHire)) {
        errorReport.push({ row: 0, message: `科目 ${row.accountCode} 金額不可為負數` });
        continue;
      }

      const derived = deriveLineTotals({
        priorYearOriginalBudget: row.priorYearOriginalBudget || "0",
        nextYearTargetExcludingNew: excludingNew,
        nextYearNewHireBudget: newHire,
      });

      await tx.budgetLine.update({
        where: { id: line.id },
        data: {
          priorPriorYearActual: new Decimal(row.priorPriorYearActual || "0"),
          priorYearOriginalBudget: new Decimal(row.priorYearOriginalBudget || "0"),
          currentYearProjection: row.currentYearProjection ? new Decimal(row.currentYearProjection) : null,
          projectionIsComplete: row.currentYearProjection !== null,
          nextYearTargetExcludingNew: excludingNew,
          nextYearNewHireBudget: newHire,
          nextYearTotal: derived.nextYearTotal,
          growthRateExcludingNew: derived.growthRateExcludingNew,
          growthRateIncludingNew: derived.growthRateIncludingNew,
        },
      });
      successRows++;
    }

    if (errorReport.length > 0 && successRows === 0) {
      // Nothing usable in the whole file - fail the batch and roll back.
      throw new ApiError(422, `匯入失敗，${errorReport.length} 筆資料有誤: ${JSON.stringify(errorReport.slice(0, 20))}`);
    }

    const committed = await tx.importBatch.update({
      where: { id: batch.id },
      data: {
        status: "COMMITTED",
        successRows,
        errorCount: errorReport.length,
        errorReport: errorReport as never,
        committedAt: new Date(),
      },
    });

    await writeAuditLog(
      {
        actorUserId: user.id,
        action: "BUDGET_LINE_IMPORT",
        entityType: "BudgetVersion",
        entityId: versionId,
        afterData: { batchId: batch.id, successRows, errorCount: errorReport.length },
      },
      tx
    );

    return committed;
  });
}
