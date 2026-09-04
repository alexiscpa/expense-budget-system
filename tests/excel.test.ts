import { describe, it, expect, beforeEach } from "vitest";
import ExcelJS from "exceljs";
import { resetDatabase } from "./helpers/reset";
import { createDepartment, createUser, createAccount, grantDepartmentScope, toCurrentUser } from "./helpers/factory";
import { createBudgetVersionDraft } from "@/lib/budget/lineService";
import {
  BUDGET_LINE_TEMPLATE_HEADERS,
  parseBudgetLineWorkbook,
  commitBudgetLineImport,
} from "@/lib/excel/importBudgetLines";
import { sanitizeCellText } from "@/lib/excel/sanitize";
import { prisma } from "@/lib/prisma";

beforeEach(async () => {
  await resetDatabase();
});

async function buildWorkbookBuffer(headers: readonly string[], rows: (string | number | null)[][]) {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("data");
  sheet.addRow([...headers]);
  for (const row of rows) sheet.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("Excel formula-injection prevention", () => {
  it("prefixes dangerous leading characters so Excel treats them as text, not formulas", () => {
    expect(sanitizeCellText("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
    expect(sanitizeCellText("+1+1")).toBe("'+1+1");
    expect(sanitizeCellText("-cmd|' /C calc'!A1")).toBe("'-cmd|' /C calc'!A1");
    expect(sanitizeCellText("@SUM(1)")).toBe("'@SUM(1)");
    expect(sanitizeCellText("normal text")).toBe("normal text");
  });
});

describe("budget line Excel import", () => {
  it("rejects a file whose header row does not exactly match the versioned template", async () => {
    const buffer = await buildWorkbookBuffer(["科目編號", "序", "項目"], [["A001", "1", "測試"]]);
    const preview = await parseBudgetLineWorkbook(buffer);
    expect(preview.headerMatches).toBe(false);
  });

  it("parses a well-formed file and reports numeric-format errors per row", async () => {
    const buffer = await buildWorkbookBuffer(BUDGET_LINE_TEMPLATE_HEADERS, [
      ["A001", "1", "郵電費", 1000, 1200, 1100, "abc", 0],
    ]);
    const preview = await parseBudgetLineWorkbook(buffer);
    expect(preview.headerMatches).toBe(true);
    expect(preview.errors).toHaveLength(1);
    expect(preview.validRows).toHaveLength(0);
  });

  it("commits valid rows into an editable version but never overwrites a locked (formula/not-budgeted) line", async () => {
    const dept = await createDepartment();
    const owner = await createUser({ role: "BUDGET_OWNER", companyWide: false });
    await grantDepartmentScope(owner.id, dept.id);
    const inputAccount = await createAccount({ code: "A500", entryType: "DEPARTMENT_INPUT", majorCategory: dept.class });
    const lockedAccount = await createAccount({ code: "A501", entryType: "NOT_BUDGETED", majorCategory: dept.class });

    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2027);

    const buffer = await buildWorkbookBuffer(BUDGET_LINE_TEMPLATE_HEADERS, [
      [inputAccount.code, "1", inputAccount.name, 1000, 1200, 1100, 1300, 200],
      [lockedAccount.code, "2", lockedAccount.name, 0, 0, 0, 9999, 0], // attempted override - must be ignored
    ]);
    const preview = await parseBudgetLineWorkbook(buffer);
    expect(preview.errors).toHaveLength(0);

    await commitBudgetLineImport(toCurrentUser(owner), draft.id, { fileName: "lines.xlsx", buffer }, preview.validRows);

    const updatedInput = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: draft.id, accountId: inputAccount.id } });
    expect(updatedInput.nextYearTargetExcludingNew.toString()).toBe("1300");
    expect(updatedInput.nextYearTotal.toString()).toBe("1500");

    const updatedLocked = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: draft.id, accountId: lockedAccount.id } });
    expect(updatedLocked.nextYearTargetExcludingNew.toString()).toBe("0"); // unchanged, still locked at 0
  });
});
