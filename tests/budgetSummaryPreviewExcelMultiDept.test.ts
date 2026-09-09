import { describe, it, expect, beforeEach, afterEach } from "vitest";
import ExcelJS from "exceljs";
import { resetDatabase } from "./helpers/reset";
import { createUser, toCurrentUser, grantDepartmentScope } from "./helpers/factory";
import { prisma } from "@/lib/prisma";
import { runStage2ATestSeed, STAGE2A_BUDGET_FISCAL_YEAR } from "@/lib/testdata/stage2aSeed";
import { testBypassUser } from "@/lib/auth/testBypass";
import { updateDepartmentInputLine } from "@/lib/budget/lineService";
import { fetchDeptSummaryEntries } from "@/lib/reports/fetchFinanceVersion";
import { KNOWN_DEPARTMENT_CODES } from "@/lib/reports/budgetSummaryPreviewData";
import { buildDeptAgg, buildLineAgg, isSgaClass, isProductionClass, type DeptSummaryEntry } from "@/lib/reports/multiDepartmentSummary";
import { SGA_REPORTING_ACCOUNTS, PRODUCTION_REPORTING_ACCOUNTS } from "@/lib/reports/reportingAccountMap";
import { STATUS_LABEL } from "@/lib/reports/summaryReportData";
import { formatTaipeiDate } from "@/lib/format/date";
import { buildBudgetSummaryPreviewExcel } from "@/lib/excel/budgetSummaryPreviewExport";

/**
 * End-to-end regression test for the "web shows Stage 2A data, Excel shows
 * an empty placeholder" bug: seeds a REAL local Postgres database, calls the
 * exact same fetchDeptSummaryEntries() query the web page uses, generates a
 * REAL .xlsx buffer through buildBudgetSummaryPreviewExcel, and reads it
 * back with ExcelJS to assert on actual cell values - never a mock, never
 * just a Content-Type/HTTP-200 check (see the task's explicit "不接受只測
 * mock資料或Content-Type" requirement).
 */

const ORIGINAL_VERCEL_ENV = process.env.VERCEL_ENV;
const ORIGINAL_AUTH_DISABLED = process.env.AUTH_DISABLED;

function setEnv(vercelEnv: string | undefined, authDisabled: string | undefined) {
  if (vercelEnv === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = vercelEnv;
  if (authDisabled === undefined) delete process.env.AUTH_DISABLED;
  else process.env.AUTH_DISABLED = authDisabled;
}

afterEach(() => {
  setEnv(ORIGINAL_VERCEL_ENV, ORIGINAL_AUTH_DISABLED);
});

beforeEach(async () => {
  await resetDatabase();
  setEnv("preview", "true");
});

const STAGE2A_CODES = ["17103", "17303", "12111", "20001", "11122", "11322", "16124", "16204"];

/** Every cell value across every sheet, flattened - used for "no #REF!/#VALUE! anywhere, file genuinely has content" style whole-file assertions. */
function allCellValues(workbook: ExcelJS.Workbook): unknown[] {
  const values: unknown[] = [];
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell((cell) => values.push(cell.value));
    });
  });
  return values;
}

/** Row number (not the mistyped Cell.row - exceljs's own type defs declare it `string`) of the first cell containing `text`, plus the cell itself. */
function findCellByText(sheet: ExcelJS.Worksheet, text: string): { row: number; cell: ExcelJS.Cell } | undefined {
  let found: { row: number; cell: ExcelJS.Cell } | undefined;
  sheet.eachRow((row, rowNumber) => {
    if (found) return;
    row.eachCell((cell) => {
      if (found) return;
      if (typeof cell.value === "string" && cell.value.includes(text)) found = { row: rowNumber, cell };
    });
  });
  return found;
}

function rowValues(sheet: ExcelJS.Worksheet, rowNumber: number): unknown[] {
  const row = sheet.getRow(rowNumber);
  const values: unknown[] = [];
  row.eachCell({ includeEmpty: true }, (cell) => values.push(cell.value));
  return values;
}

describe("budget summary preview Excel export - multi-department root-cause fix", () => {
  it("root cause: the OLD export path (fetchFinanceDepartmentAndVersion) never sees Stage 2A departments at all, even after seeding them", async () => {
    await runStage2ATestSeed(testBypassUser());
    const { fetchFinanceDepartmentAndVersion } = await import("@/lib/reports/fetchFinanceVersion");
    const { financeDepartment, financeVersion } = await fetchFinanceDepartmentAndVersion();
    // 財務管理處 (17203) has no Department row at all in this environment
    // (nothing seeds it outside the separate DEMO-master-data flow) and
    // certainly no fiscalYear=2027 draft - the old Excel path had nothing
    // else to fall back to, which is exactly why every export showed
    // "未編製" for every row even though 8 real Stage 2A departments with
    // real 2027 figures exist right next to it in the same database.
    expect(financeDepartment).toBeNull();
    expect(financeVersion).toBeNull();

    const deptEntries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);
    const stage2aEntries = deptEntries.filter((e) => e.isTestData);
    expect(stage2aEntries).toHaveLength(8);
    expect(stage2aEntries.every((e) => e.version !== null)).toBe(true);
  });

  it("unit-all sheet: 檔案不是空白, all 8 Stage 2A departments present with their real 【測試資料】-badged names", async () => {
    await runStage2ATestSeed(testBypassUser());
    const deptEntries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);

    const buffer = await buildBudgetSummaryPreviewExcel("unit-all", { deptEntries, scope: "draft_included", exportedAtIso: "2026-09-09T03:00:00.000Z" });
    expect(buffer.length).toBeGreaterThan(0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0]!;

    const stage2aEntries = deptEntries.filter((e) => e.isTestData);
    expect(stage2aEntries).toHaveLength(8);
    for (const entry of stage2aEntries) {
      const found = findCellByText(sheet, entry.name);
      expect(found, `expected to find a cell for department ${entry.name}`).toBeDefined();
      expect(found!.cell.value).toContain("【測試資料】");
    }
  });

  it("每個 Stage 2A 部門：Excel 的 2026人數/2026推估/2027人數/狀態/最後編製日期 與 buildDeptAgg（網頁彙總的同一計算函式）完全一致", async () => {
    await runStage2ATestSeed(testBypassUser());
    const deptEntries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);
    const exportedAtIso = "2026-09-09T03:00:00.000Z";

    const buffer = await buildBudgetSummaryPreviewExcel("unit-all", { deptEntries, scope: "draft_included", exportedAtIso });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0]!;

    for (const code of STAGE2A_CODES) {
      const entry = deptEntries.find((e) => e.code === code)!;
      const agg = buildDeptAgg(entry.version)!;
      const nameCell = findCellByText(sheet, entry.name)!;
      const row = rowValues(sheet, nameCell.row);
      // [部門, 人數, 費用金額, 編制人數, 預算金額, 新員預算, 合計, 增減金額, 成長率, 狀態, 最後編製日期]
      expect(row[1]).toBe(entry.version!.priorYearHeadcount);
      expect(row[2]).toBe(agg.priorTotal.toNumber());
      expect(row[3]).toBe(entry.version!.budgetYearHeadcount);
      expect(row[9]).toBe(STATUS_LABEL[entry.version!.status] ?? entry.version!.status);
      // A real Excel date value (not a string) - see taipeiDateOnly.
      expect(row[10]).toBeInstanceOf(Date);
      expect(formatTaipeiDate(row[10] as Date)).toBe(formatTaipeiDate(entry.version!.lastPreparedAt));
    }
  });

  it("尚未輸入 2027 金額的部門顯示「—」（never 0）；一旦真的輸入，Excel 顯示真實數字，且與 buildDeptAgg 一致", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    const owner = await createUser({ role: "BUDGET_OWNER" });
    await runStage2ATestSeed(toCurrentUser(admin));

    const taipei = await prisma.department.findUniqueOrThrow({ where: { code: "12111" } });
    await grantDepartmentScope(owner.id, taipei.id);
    const version = await prisma.budgetVersion.findFirstOrThrow({
      where: { departmentId: taipei.id, fiscalYear: STAGE2A_BUDGET_FISCAL_YEAR },
      include: { lines: true },
    });

    // Before any input: 2027 columns must be "—", never a fabricated 0.
    {
      const deptEntries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);
      const buffer = await buildBudgetSummaryPreviewExcel("unit-all", { deptEntries, scope: "draft_included", exportedAtIso: "2026-09-09T00:00:00.000Z" });
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const sheet = workbook.worksheets[0]!;
      const nameCell = findCellByText(sheet, "台北")!;
      const row = rowValues(sheet, nameCell.row);
      expect(row[4]).toBe("—"); // 預算金額 (excludingNew)
      expect(row[6]).toBe("—"); // 合計
    }

    // Enter a real amount (including an explicit 0 for new-hire budget).
    const line = version.lines[0]!;
    await updateDepartmentInputLine(toCurrentUser(owner), version.id, line.id, {
      nextYearTargetExcludingNew: "654321",
      nextYearNewHireBudget: "0",
    });

    const deptEntries2 = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);
    const taipeiEntry = deptEntries2.find((e) => e.code === "12111")!;
    const agg = buildDeptAgg(taipeiEntry.version)!;
    expect(agg.excludingNewTotal?.toNumber()).toBeGreaterThan(0);

    const buffer2 = await buildBudgetSummaryPreviewExcel("unit-all", { deptEntries: deptEntries2, scope: "draft_included", exportedAtIso: "2026-09-09T00:00:00.000Z" });
    const workbook2 = new ExcelJS.Workbook();
    await workbook2.xlsx.load(buffer2);
    const sheet2 = workbook2.worksheets[0]!;
    const nameCell2 = findCellByText(sheet2, "台北")!;
    const row2 = rowValues(sheet2, nameCell2.row);
    expect(row2[4]).toBe(agg.excludingNewTotal!.toNumber());
    expect(row2[6]).toBe(agg.grandTotal!.toNumber()); // 合計(含新員) - real number, never text
    expect(typeof row2[6]).toBe("number"); // amount cells are numeric, never a "—" string once real
  });

  it("SGA 科目彙總表：科目彙總不列部門，只依 reportingAccountKey 合計，且合計數與 buildLineAgg（網頁同一計算）完全一致 (106,985,400)", async () => {
    const result = await runStage2ATestSeed(testBypassUser());
    const deptEntries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);

    const buffer = await buildBudgetSummaryPreviewExcel("sga", { deptEntries, scope: "draft_included", exportedAtIso: "2026-09-09T00:00:00.000Z" });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0]!;

    // No department name anywhere in this sheet - the account table must
    // never repeat a department per row (spec §四-2 "不得列部門"). The
    // department-overview mini-table above it is allowed to name
    // departments (that's a different, explicitly-scoped table), so check
    // specifically that a production-only department name never appears.
    const allText = allCellValues(workbook).filter((v): v is string => typeof v === "string");
    expect(allText.some((t) => t.includes("生產部"))).toBe(false);
    expect(allText.some((t) => t.includes("台灣廠品保處"))).toBe(false);

    const sgaCodes = ["17103", "17303", "12111", "20001", "11122", "11322"];
    const sgaEntries = deptEntries.filter((e) => sgaCodes.includes(e.code));
    const mappedCodes = new Set(SGA_REPORTING_ACCOUNTS.flatMap((m) => Object.values(m.sourceCodes)));
    const allMappedLines = sgaEntries.flatMap((e) => (e.version ? e.version.lines.filter((l) => mappedCodes.has(l.account.code)) : []));
    const grandAgg = buildLineAgg(allMappedLines);
    expect(grandAgg.prior.toNumber()).toBe(106985400);

    const totalCell = findCellByText(sheet, "管銷研費用總計")!;
    const totalRow = rowValues(sheet, totalCell.row);
    // [序, 報表科目編號, 會計科目名稱, 2026推估, ...]
    expect(totalRow[3]).toBe(106985400);

    const expectedFromApi = result.departments.filter((d) => sgaCodes.includes(d.code)).reduce((acc, d) => acc + Number(d.totalProjection2026), 0);
    expect(totalRow[3]).toBe(expectedFromApi);
  });

  it("生產科目彙總表：合計數與網頁同一計算函式一致 (198,192,300) - 生產資料不再被當成「尚無資料」的全空白版型", async () => {
    const result = await runStage2ATestSeed(testBypassUser());
    const deptEntries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);

    const buffer = await buildBudgetSummaryPreviewExcel("production", { deptEntries, scope: "draft_included", exportedAtIso: "2026-09-09T00:00:00.000Z" });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0]!;

    const prodCodes = ["16124", "16204"];
    const prodEntries = deptEntries.filter((e) => prodCodes.includes(e.code));
    const mappedCodes = new Set(PRODUCTION_REPORTING_ACCOUNTS.flatMap((m) => Object.values(m.sourceCodes)));
    const allMappedLines = prodEntries.flatMap((e) => (e.version ? e.version.lines.filter((l) => mappedCodes.has(l.account.code)) : []));
    const grandAgg = buildLineAgg(allMappedLines);
    expect(grandAgg.prior.toNumber()).toBe(198192300);

    const totalCell = findCellByText(sheet, "生產費用總計")!;
    const totalRow = rowValues(sheet, totalCell.row);
    expect(totalRow[3]).toBe(198192300);

    const expectedFromApi = result.departments.filter((d) => prodCodes.includes(d.code)).reduce((acc, d) => acc + Number(d.totalProjection2026), 0);
    expect(totalRow[3]).toBe(expectedFromApi);

    // Overview mini-table on this sheet DOES name departments (that part of
    // the spec is unrelated to the "不得列部門" rule on the account table).
    expect(findCellByText(sheet, "生產部")).toBeDefined();
  });

  it("全公司費用合計 sheet 的管銷研/生產合計，與 SGA/生產科目彙總表各自的合計數完全相同（避免各頁總額不一致）", async () => {
    await runStage2ATestSeed(testBypassUser());
    const deptEntries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);

    const buffer = await buildBudgetSummaryPreviewExcel("company", { deptEntries, scope: "draft_included", exportedAtIso: "2026-09-09T00:00:00.000Z" });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0]!;

    const sgaRow = rowValues(sheet, findCellByText(sheet, "管銷研費用合計")!.row);
    const prodRow = rowValues(sheet, findCellByText(sheet, "生產費用合計")!.row);
    expect(sgaRow[1]).toBe(106985400);
    expect(prodRow[1]).toBe(198192300);
  });

  it("匯出全部彙總表：一次呼叫至少產生三個必要工作表（單位別費用與編制／管銷研科目彙總／生產科目彙總），三者出自同一份 deptEntries 快照，總額互相一致", async () => {
    await runStage2ATestSeed(testBypassUser());
    const deptEntries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);

    const buffer = await buildBudgetSummaryPreviewExcel("full", { deptEntries, scope: "draft_included", exportedAtIso: "2026-09-09T00:00:00.000Z" });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    const sheetNames = workbook.worksheets.map((s) => s.name);
    expect(sheetNames).toContain("單位別費用與編制");
    expect(sheetNames).toContain("管銷研科目彙總");
    expect(sheetNames).toContain("生產科目彙總");

    const sgaSheet = workbook.getWorksheet("管銷研科目彙總")!;
    const sgaTotalRow = rowValues(sgaSheet, findCellByText(sgaSheet, "管銷研費用總計")!.row);
    expect(sgaTotalRow[3]).toBe(106985400);

    const companySheet = workbook.getWorksheet("全公司費用合計")!;
    const companySgaRow = rowValues(companySheet, findCellByText(companySheet, "管銷研費用合計")!.row);
    expect(companySgaRow[1]).toBe(106985400); // same number as the SGA sheet's own total - never recomputed differently
  });

  it("SUBMITTED 狀態的部門（資訊處）在 Excel 顯示正確狀態與已輸入金額", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    await runStage2ATestSeed(toCurrentUser(admin));

    const it17103 = await prisma.department.findUniqueOrThrow({ where: { code: "17103" } });
    const version = await prisma.budgetVersion.findFirstOrThrow({ where: { departmentId: it17103.id, fiscalYear: STAGE2A_BUDGET_FISCAL_YEAR } });
    // Match the PR's existing 資訊處=SUBMITTED fixture state.
    await prisma.budgetVersion.update({ where: { id: version.id }, data: { status: "SUBMITTED" } });

    const deptEntries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);
    const buffer = await buildBudgetSummaryPreviewExcel("unit-all", { deptEntries, scope: "draft_included", exportedAtIso: "2026-09-09T00:00:00.000Z" });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0]!;

    const nameCell = findCellByText(sheet, "資訊處")!;
    const row = rowValues(sheet, nameCell.row);
    expect(row[9]).toBe("已送出");
  });

  it("「包含草稿」範圍不得排除 DRAFT/RETURNED - 一個 RETURNED 狀態的部門仍出現在 Excel 中並保留其數字", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    await runStage2ATestSeed(toCurrentUser(admin));

    const dept = await prisma.department.findUniqueOrThrow({ where: { code: "11322" } }); // 研發一部
    const version = await prisma.budgetVersion.findFirstOrThrow({ where: { departmentId: dept.id, fiscalYear: STAGE2A_BUDGET_FISCAL_YEAR } });
    await prisma.budgetVersion.update({ where: { id: version.id }, data: { status: "RETURNED", returnReason: "測試退回" } });

    const deptEntries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);
    const buffer = await buildBudgetSummaryPreviewExcel("unit-all", { deptEntries, scope: "draft_included", exportedAtIso: "2026-09-09T00:00:00.000Z" });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0]!;

    const nameCell = findCellByText(sheet, "研發一部")!;
    const row = rowValues(sheet, nameCell.row);
    expect(row[9]).toBe("已退回");
    expect(typeof row[2]).toBe("number"); // 2026 推估 still a real number, not excluded by scope
  });

  it("formula-injection: a department name starting with = is never written as a live Excel formula", async () => {
    const admin = await createUser({ role: "SYSTEM_ADMIN", companyWide: true });
    await runStage2ATestSeed(toCurrentUser(admin));

    // The unit-all sheet's department column shows UNIT_BLOCKS' own static
    // representative label (keyed only by code) - exactly like the web
    // page's UnitTab - so a renamed live Department.name never surfaces
    // there. The SGA sheet's "部門總覽" mini-table DOES show the live
    // entry.name (like the web's DeptOverviewRows), so exercise the
    // sanitizer there instead.
    const dept = await prisma.department.findUniqueOrThrow({ where: { code: "12111" } });
    await prisma.department.update({ where: { id: dept.id }, data: { name: "=cmd|' /C calc'!A1" } });

    const deptEntries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);
    const buffer = await buildBudgetSummaryPreviewExcel("sga", { deptEntries, scope: "draft_included", exportedAtIso: "2026-09-09T00:00:00.000Z" });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0]!;

    const found = findCellByText(sheet, "cmd|")!;
    expect(found.cell.value).toBe("'=cmd|' /C calc'!A1【測試資料】");
    expect(typeof found.cell.value).toBe("string"); // never an ExcelJS formula object ({formula: ...})
  });

  it("匯出檔案沒有任何 #REF!/#VALUE!/#NAME? 錯誤字串，且沒有任何即時公式儲存格", async () => {
    await runStage2ATestSeed(testBypassUser());
    const deptEntries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);
    const buffer = await buildBudgetSummaryPreviewExcel("full", { deptEntries, scope: "draft_included", exportedAtIso: "2026-09-09T00:00:00.000Z" });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);

    for (const value of allCellValues(workbook)) {
      if (typeof value === "string") {
        expect(value).not.toMatch(/#REF!|#VALUE!|#NAME\?|#DIV\/0!|#N\/A/);
      }
      expect(typeof value === "object" && value !== null && "formula" in value).toBe(false);
    }
  });

  it("凍結窗格、欄寬、列印範圍、重複標題設定正常", async () => {
    await runStage2ATestSeed(testBypassUser());
    const deptEntries = await fetchDeptSummaryEntries(KNOWN_DEPARTMENT_CODES);
    const buffer = await buildBudgetSummaryPreviewExcel("unit-all", { deptEntries, scope: "draft_included", exportedAtIso: "2026-09-09T00:00:00.000Z" });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0]!;

    const view = sheet.views?.[0] as { state?: string; xSplit?: number; ySplit?: number } | undefined;
    expect(view?.state).toBe("frozen");
    expect(view?.xSplit).toBeGreaterThanOrEqual(1);
    expect(view?.ySplit).toBeGreaterThan(0);

    expect(sheet.getColumn(1).width).toBeGreaterThan(0);
    expect(sheet.pageSetup?.printArea).toBeTruthy();
    expect(sheet.pageSetup?.printTitlesRow).toBeTruthy();
    expect(sheet.pageSetup?.fitToWidth).toBe(1);
    expect(sheet.name.length).toBeLessThanOrEqual(31);
  });
});
