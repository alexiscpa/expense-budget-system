import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resetDatabase } from "./helpers/reset";
import { createDepartment, createUser, createAccount, grantDepartmentScope, toCurrentUser } from "./helpers/factory";
import { createBudgetVersionDraft, updateDepartmentInputLine, deriveLineTotals } from "@/lib/budget/lineService";
import { updateBudgetYearHeadcount } from "@/lib/budget/headcountService";
import { submitBudgetVersion, withdrawBudgetSubmission } from "@/lib/workflow/actions";
import { prisma } from "@/lib/prisma";
import { Decimal } from "@/lib/money/decimal";

beforeEach(async () => {
  await resetDatabase();
});

async function setupDept(opts: {
  priorYearHeadcount?: number | null;
  headcountReferenceYear?: number | null;
  accountReferenceAmount?: string | null;
  accountReferenceYear?: number | null;
}) {
  const dept = await createDepartment({
    code: `YR${Date.now()}${Math.random()}`,
    priorYearHeadcount: opts.priorYearHeadcount ?? null,
    priorYearReferenceFiscalYear: opts.headcountReferenceYear ?? null,
  });
  const owner = await createUser({ role: "BUDGET_OWNER", companyWide: false });
  await grantDepartmentScope(owner.id, dept.id);
  const account = await createAccount({
    entryType: "DEPARTMENT_INPUT",
    majorCategory: dept.class,
    priorYearReferenceAmount: opts.accountReferenceAmount ?? null,
    priorYearReferenceFiscalYear: opts.accountReferenceYear ?? null,
  });
  return { dept, owner, account };
}

describe("年度相對邏輯：referenceYear = fiscalYear - 1, budgetYear = fiscalYear", () => {
  it("2027 draft correctly reads a reference tagged for 2026 (referenceYear = 2027 - 1)", async () => {
    const { dept, owner } = await setupDept({
      priorYearHeadcount: 12,
      headcountReferenceYear: 2026,
      accountReferenceAmount: "500000",
      accountReferenceYear: 2026,
    });
    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2027);
    expect(draft.priorYearHeadcount).toBe(12);

    const line = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: draft.id } });
    expect(line.priorYearOriginalBudget.toString()).toBe("500000");
    expect(line.projectionIsComplete).toBe(true);
  });

  it("2027資料不得誤讀2025參考金額 - a reference tagged 2025 must NOT be used for a 2027 draft (referenceYear=2026, mismatch)", async () => {
    const { dept, owner } = await setupDept({
      priorYearHeadcount: 10,
      headcountReferenceYear: 2025,
      accountReferenceAmount: "7905511", // the real DEMO 薪資支出 2025 figure
      accountReferenceYear: 2025,
    });
    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2027);

    // Never silently relabeled as if it were 2026's figure.
    expect(draft.priorYearHeadcount).toBeNull();
    const line = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: draft.id } });
    expect(line.priorYearOriginalBudget.toString()).toBe("0");
    expect(line.projectionIsComplete).toBe(false);
    expect(line.priorYearOriginalBudget.toString()).not.toBe("7905511");
  });

  it("fiscalYear 改成 2028 時，自動使用 2027／2028 (referenceYear generalizes beyond 2026/2027)", async () => {
    const { dept, owner } = await setupDept({
      priorYearHeadcount: 20,
      headcountReferenceYear: 2027,
      accountReferenceAmount: "888888",
      accountReferenceYear: 2027,
    });
    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2028);
    expect(draft.fiscalYear).toBe(2028);
    expect(draft.priorYearHeadcount).toBe(20);

    const line = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: draft.id } });
    expect(line.priorYearOriginalBudget.toString()).toBe("888888");
    expect(line.projectionIsComplete).toBe(true);

    // The SAME account's 2025-vintage data (if any) would still be wrong for
    // this draft - confirm no 2025/2026 value leaked in by checking the
    // exact figure equals only the 2027-tagged reference.
    expect(line.priorYearOriginalBudget.toString()).not.toBe("0");
  });

  it("無前年度推估時（帳戶與部門皆無資料），欄位皆顯示為 null，不可為 0 或虛構數字", async () => {
    const { dept, owner } = await setupDept({});
    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2030);
    expect(draft.priorYearHeadcount).toBeNull();
    expect(draft.budgetYearHeadcount).toBe(0);

    const line = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: draft.id } });
    expect(line.projectionIsComplete).toBe(false);
    expect(line.currentYearProjection).toBeNull();
    expect(line.priorYearOriginalBudget.toString()).toBe("0");
  });

  it("增減金額及增減率以 referenceYear 推估為基準 - correct math when a valid reference exists", async () => {
    const { dept, owner } = await setupDept({
      accountReferenceAmount: "1000000",
      accountReferenceYear: 2026,
    });
    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2027);
    const line = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: draft.id } });

    const updated = await updateDepartmentInputLine(toCurrentUser(owner), draft.id, line.id, {
      nextYearTargetExcludingNew: "1100000",
      nextYearNewHireBudget: "0",
    });

    // 2027合計 = 1,100,000；增減金額 = 1,100,000 - 1,000,000 = 100,000；增減率 = 100,000 / 1,000,000 = 10%
    expect(updated.nextYearTotal.toString()).toBe("1100000");
    expect(new Decimal(updated.priorYearOriginalBudget).toString()).toBe("1000000");
    expect(Number(updated.nextYearTotal) - Number(updated.priorYearOriginalBudget)).toBe(100000);
    expect(updated.growthRateIncludingNew?.toString()).toBe("0.1");
  });

  it("2026推估為 0 時，增減率顯示為 null（不可除以零），即使有確認年度的參考資料", async () => {
    const { dept, owner } = await setupDept({
      accountReferenceAmount: "0",
      accountReferenceYear: 2026,
    });
    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2027);
    const line = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: draft.id } });
    expect(line.projectionIsComplete).toBe(true); // a real, confirmed reference of 0 - not "missing"
    expect(line.priorYearOriginalBudget.toString()).toBe("0");

    const updated = await updateDepartmentInputLine(toCurrentUser(owner), draft.id, line.id, {
      nextYearTargetExcludingNew: "50000",
      nextYearNewHireBudget: "0",
    });
    expect(updated.growthRateIncludingNew).toBeNull();
  });

  it("deriveLineTotals never divides by zero regardless of caller", () => {
    const derived = deriveLineTotals({
      priorYearOriginalBudget: new Decimal(0),
      nextYearTargetExcludingNew: new Decimal(50000),
      nextYearNewHireBudget: new Decimal(0),
    });
    expect(derived.growthRateExcludingNew).toBeNull();
    expect(derived.growthRateIncludingNew).toBeNull();
    expect(derived.nextYearTotal.toString()).toBe("50000");
  });

  it("儲存、重整（重新讀取）、撤回修改及最後編製日期在無前年度推估的年度（如 2029）仍正常運作", async () => {
    const { dept, owner } = await setupDept({});
    const draft = await createBudgetVersionDraft(toCurrentUser(owner), dept.id, 2029);
    const line = await prisma.budgetLine.findFirstOrThrow({ where: { budgetVersionId: draft.id } });

    // Save a real figure despite there being no prior-year reference at all.
    await updateDepartmentInputLine(toCurrentUser(owner), draft.id, line.id, {
      nextYearTargetExcludingNew: "300000",
      nextYearNewHireBudget: "20000",
      justification: "無前期資料，依部門估算",
    });
    await updateBudgetYearHeadcount(toCurrentUser(owner), draft.id, "7");

    // 重新整理 - a fresh read reflects everything just saved.
    const reloaded = await prisma.budgetVersion.findUniqueOrThrow({
      where: { id: draft.id },
      include: { lines: true },
    });
    expect(reloaded.budgetYearHeadcount).toBe(7);
    expect(reloaded.priorYearHeadcount).toBeNull();
    const reloadedLine = reloaded.lines.find((l) => l.id === line.id)!;
    expect(reloadedLine.nextYearTargetExcludingNew.toString()).toBe("300000");
    expect(reloadedLine.nextYearNewHireBudget.toString()).toBe("20000");
    expect(reloadedLine.justification).toBe("無前期資料，依部門估算");
    const lastPreparedAfterEdit = reloaded.lastPreparedAt;

    // 送出 -> 撤回修改 -> 重新修改
    await submitBudgetVersion(toCurrentUser(owner), draft.id);
    await withdrawBudgetSubmission(toCurrentUser(owner), draft.id);

    const afterWithdraw = await prisma.budgetVersion.findUniqueOrThrow({ where: { id: draft.id } });
    expect(afterWithdraw.status).toBe("DRAFT");
    expect(afterWithdraw.budgetYearHeadcount).toBe(7); // preserved across withdraw
    expect(afterWithdraw.lastPreparedAt.getTime()).toBe(lastPreparedAfterEdit.getTime()); // withdraw itself never bumps it

    await updateDepartmentInputLine(toCurrentUser(owner), draft.id, line.id, {
      nextYearTargetExcludingNew: "350000",
      nextYearNewHireBudget: "20000",
      justification: "撤回後修改",
    });
    const afterReEdit = await prisma.budgetVersion.findUniqueOrThrow({ where: { id: draft.id } });
    expect(afterReEdit.lastPreparedAt.getTime()).toBeGreaterThan(lastPreparedAfterEdit.getTime());
  });
});

describe("畫面不得殘留寫死的舊年度標題 (regression guard)", () => {
  it("BudgetVersionClient.tsx 原始碼中不再出現任何「2025推估」「2026預算」等寫死年度字樣", () => {
    const filePath = path.join(process.cwd(), "src/app/dashboard/budgets/[id]/BudgetVersionClient.tsx");
    const source = fs.readFileSync(filePath, "utf-8");
    for (const forbidden of ["2025推估", "2026預算", "2025 推估", "2025 年參考人數", "資料不全，待確認"]) {
      expect(source).not.toContain(forbidden);
    }
    // Every year-bearing label must instead be built from the dynamically
    // computed referenceYear/budgetYear variables.
    expect(source).toContain("const referenceYear = version.fiscalYear - 1;");
    expect(source).toContain("const budgetYear = version.fiscalYear;");
  });
});
