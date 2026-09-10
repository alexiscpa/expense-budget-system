import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { Decimal, toDecimal, growthRate, isNegative } from "@/lib/money/decimal";
import type { CurrentUser } from "@/lib/auth/session";
import { requireCapability, requireDepartmentAccess, ApiError } from "@/lib/rbac/guard";
import { isEditable } from "@/lib/workflow/stateMachine";
import { writeAuditLog, buildAuditLogData } from "@/lib/audit/log";
import { evaluateFormula } from "@/lib/formula/engine";
import { isTestBypassUser } from "@/lib/auth/testBypass";

export interface DerivedFields {
  nextYearTotal: Decimal;
  growthRateExcludingNew: Decimal | null;
  growthRateIncludingNew: Decimal | null;
}

export function deriveLineTotals(params: {
  priorYearOriginalBudget: Decimal.Value;
  nextYearTargetExcludingNew: Decimal.Value;
  nextYearNewHireBudget: Decimal.Value;
}): DerivedFields {
  const excludingNew = toDecimal(params.nextYearTargetExcludingNew);
  const newHire = toDecimal(params.nextYearNewHireBudget);
  const nextYearTotal = excludingNew.plus(newHire);
  const base = toDecimal(params.priorYearOriginalBudget);
  return {
    nextYearTotal,
    growthRateExcludingNew: growthRate(base, excludingNew),
    growthRateIncludingNew: growthRate(base, nextYearTotal),
  };
}

/**
 * Creates a DRAFT BudgetVersion (versionNumber 1) for a department/fiscal
 * year and materializes one BudgetLine per active Account. FORMULA and
 * NOT_BUDGETED accounts are locked immediately; DEPARTMENT_INPUT lines start
 * at 0 pending manual entry. Prior-period figures (實績/目標/推移) must be
 * populated separately via the budget-line import flow using real actuals -
 * they are never fabricated here.
 *
 * Performance/atomicity note: this used to create the BudgetVersion and then
 * loop over every account, `await`-ing one `tx.budgetLine.create()` per
 * account inside an interactive `prisma.$transaction(async (tx) => ...)`
 * callback. Each awaited call is a full Node <-> Neon network round trip;
 * for a 62-account department that is 60+ sequential round trips inside one
 * transaction, and under real Neon serverless latency this exceeded
 * Prisma's 5-second interactive-transaction timeout, surfacing as
 * `PrismaClientKnownRequestError P2028: Transaction already closed`
 * (the same class of bug already fixed for the 62-account DEMO seed in
 * seedDemoMasterData.ts - see that file's comments for the general
 * pattern). FORMULA-account evaluation (`evaluateFormula`, which reads
 * FormulaDefinition/SalaryDataSource) was already using the top-level
 * `prisma` client rather than `tx` even in the old code, so it was never
 * actually part of the write transaction's atomicity - it is now run before
 * any write starts, once per account, as plain read-only queries. The write
 * itself is exactly 3 statements - 1 BudgetVersion insert, 1 multi-row
 * BudgetLine insert (`createMany`), 1 AuditLog insert - sent together as a
 * non-interactive Prisma batch transaction (`$transaction([...])`, the
 * array form), which has no client-side timeout to exceed because the
 * query engine never waits on a Node.js round trip between statements.
 * The BudgetVersion id is generated up front (crypto.randomUUID(), a valid
 * value for its String @id column) specifically so the AuditLog row can
 * reference it (`entityId`) without needing an interactive step to read the
 * id back first.
 */
export interface CreateBudgetVersionDraftOptions {
  /**
   * When true, every applicable account's BudgetLine is snapshotted as
   * editable DEPARTMENT_INPUT/NOT_APPLICABLE/unlocked regardless of the
   * shared Account row's real entryType/formulaKey - the same override
   * stage2aSeed.ts uses for its 8 test departments (see that file's doc
   * comment for the full rationale), extended here to any department. Used
   * by the Stage 2B-2 45-department roster's lazy "開始編製" draft
   * creation (see stage2bDraftService.ts), per the explicit requirement
   * that none of those 45 units' applicable accounts may ever show
   * 尚未設定/FORMULA鎖定/NOT_BUDGETED鎖定. Never touches the shared Account
   * row itself - a real department's normal (forceEditable: false, the
   * default) draft still gets genuine FORMULA-locked/NOT_BUDGETED-fixed
   * behavior for the exact same account.
   */
  forceEditable?: boolean;
}

export async function createBudgetVersionDraft(
  user: CurrentUser,
  departmentId: string,
  fiscalYear: number,
  options: CreateBudgetVersionDraftOptions = {}
) {
  const { forceEditable = false } = options;
  await requireCapability(user, "budget.edit_own_department");
  await requireDepartmentAccess(user, departmentId);

  const existing = await prisma.budgetVersion.findFirst({
    where: { departmentId, fiscalYear, versionNumber: 1 },
  });
  if (existing) throw new ApiError(409, "此部門年度預算草稿已存在");

  // Every "prior-year reference" figure (Department.priorYearHeadcount,
  // Account.priorYearReferenceAmount below) is only ever valid for the
  // fiscal year immediately before the one being drafted - never reused
  // across a year it doesn't match, which would silently relabel an older
  // (or newer) year's figure as if it were referenceYear's. See the schema
  // comments on priorYearReferenceFiscalYear for why this exists.
  const referenceYear = fiscalYear - 1;

  // 部門人數 (department headcount) is not an accounting line item - it has
  // no Account/BudgetLine, so it is seeded directly from the department's
  // own reference figure (Department.priorYearHeadcount, set via
  // seedDemoMasterData.ts for the 17203 demo department - see its schema
  // comment), never fabricated, and only when that figure is confirmed to
  // represent referenceYear. A department with no known (or wrong-year)
  // reference simply starts both figures at null/0, exactly like an
  // account with no valid priorYearReferenceAmount starts its line at
  // 0/"資料不全，待確認".
  const department = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { class: true, priorYearHeadcount: true, priorYearReferenceFiscalYear: true },
  });
  if (!department) throw new ApiError(404, "找不到此部門");

  // Only accounts belonging to this department's own class (M/S/R/P) are
  // applicable - a management department must never see production or
  // sales accounts and vice versa.
  //
  // forceEditable additionally excludes any account carrying a sourceSeq
  // (Account.sourceSeq IS NOT NULL) - the marker seedDemoMasterData.ts
  // uses for the SEPARATE, unrelated 62-item M-class-only demo chart it
  // imports from "2026年度費用預算V2--財務.xlsx" for 17203's own one-off
  // manual demo walkthrough. That chart happens to duplicate the same 62
  // M-class concepts already present in the canonical, all-four-class
  // chart (stage2aAccounts.ts's STAGE2A_ACCOUNTS, sourceSeq always null,
  // sourced from the SAME 2025費用總表 workbook the Stage 2B-1/2B-2
  // department manifest itself is built from) - so a plain
  // majorCategory-only filter silently doubles a Stage 2B-2 M-class
  // department's applicable-account count to 124 instead of 62 (S/R/P are
  // unaffected: seedDemoMasterData never imports anything for those
  // classes). Never applied when forceEditable is false, so 17203's own
  // real createBudgetVersionDraft path - if ever invoked directly, outside
  // the Stage 2B-2 roster flow - keeps using its own established sourceSeq
  // chart untouched.
  const accounts = await prisma.account.findMany({
    where: { isActive: true, majorCategory: department.class, ...(forceEditable ? { sourceSeq: null } : {}) },
  });
  if (accounts.length === 0) {
    throw new ApiError(422, "會計科目主檔尚未匯入，請聯絡財務管理員先完成科目主檔匯入");
  }

  const departmentReferenceValid = department.priorYearReferenceFiscalYear === referenceYear;
  const priorYearHeadcount = departmentReferenceValid ? (department?.priorYearHeadcount ?? null) : null;

  // Set explicitly (rather than relying on @default(now())/@updatedAt at
  // the DB layer) so every freshly created line has createdAt and
  // updatedAt equal to the exact same JS Date value, not two independent
  // "now" evaluations (client-side vs the Postgres server) that could
  // differ by a few milliseconds. The UI uses this exact equality to
  // decide whether a 2026 amount field has ever been saved by a user -
  // see BudgetVersionClient.tsx.
  const createdAt = new Date();
  const versionId = randomUUID();

  const lineRows: Prisma.BudgetLineCreateManyInput[] = [];
  for (const account of accounts) {
    let formulaStatus: "NOT_APPLICABLE" | "CONFIGURED" | "NOT_CONFIGURED" = "NOT_APPLICABLE";
    let excludingNew = new Decimal(0);
    let isLocked = account.entryType !== "DEPARTMENT_INPUT";
    let entryTypeSnapshot: (typeof account)["entryType"] = account.entryType;

    if (!forceEditable && account.entryType === "FORMULA") {
      if (!account.formulaKey) {
        formulaStatus = "NOT_CONFIGURED";
      } else {
        const result = await evaluateFormula(account.formulaKey, departmentId, fiscalYear, new Map());
        formulaStatus = result.status;
        if (result.status === "CONFIGURED" && result.amount) {
          excludingNew = result.amount;
        }
      }
    }

    if (forceEditable) {
      // See CreateBudgetVersionDraftOptions.forceEditable's doc comment -
      // no FormulaDefinition/SalaryDataSource is ever seeded for a
      // Stage 2B-2 department at this stage, so a real FORMULA evaluation
      // would resolve NOT_CONFIGURED and permanently lock the field; a
      // NOT_BUDGETED account would stay fixed at 0 with no input at all.
      // Both are correct for a fully-configured real department but wrong
      // here. Overrides all three of entryTypeSnapshot/formulaStatus/
      // isLocked - not just the two that actually gate editability - to
      // exactly match stage2aSeed.ts's own override, so the screen never
      // shows a misleading "公式"/"不編列" label next to a line it is
      // simultaneously letting the user type into.
      entryTypeSnapshot = "DEPARTMENT_INPUT";
      formulaStatus = "NOT_APPLICABLE";
      isLocked = false;
    }

    // When the account carries a known prior-year reference amount (set
    // via a controlled import - see Account.priorYearReferenceAmount) AND
    // that figure is confirmed to represent referenceYear (fiscalYear - 1),
    // seed both read-only reference columns from it instead of leaving them
    // at 0/"資料不全，待確認": it doubles as the account's most recently
    // known "原核定預算" (目標) AND "全年推估數" (推移) for a department
    // that has not yet had a full multi-column prior-year import - the same
    // real figure, never a fabricated second number. A reference tagged for
    // any other year (or not tagged at all) is treated exactly like "no
    // reference" - it must never be reused relabeled as referenceYear's.
    const accountReferenceValid = account.priorYearReferenceFiscalYear === referenceYear;
    const referenceAmount = accountReferenceValid ? account.priorYearReferenceAmount : null;
    const priorYearOriginalBudget = referenceAmount ?? new Decimal(0);
    const derived = deriveLineTotals({
      priorYearOriginalBudget,
      nextYearTargetExcludingNew: excludingNew,
      nextYearNewHireBudget: 0,
    });

    lineRows.push({
      id: randomUUID(),
      budgetVersionId: versionId,
      accountId: account.id,
      priorPriorYearActual: 0,
      priorYearOriginalBudget,
      currentYearProjection: referenceAmount ?? null,
      projectionIsComplete: referenceAmount !== null,
      nextYearTargetExcludingNew: excludingNew,
      nextYearNewHireBudget: 0,
      nextYearTotal: derived.nextYearTotal,
      growthRateExcludingNew: derived.growthRateExcludingNew,
      growthRateIncludingNew: derived.growthRateIncludingNew,
      entryTypeSnapshot,
      formulaStatus,
      isLocked,
      createdAt,
      updatedAt: createdAt,
    });
  }

  const versionCreateQuery = prisma.budgetVersion.create({
    data: {
      id: versionId,
      departmentId,
      fiscalYear,
      versionNumber: 1,
      status: "DRAFT",
      // Initial budgetYear headcount starts equal to the confirmed
      // referenceYear figure when one exists (exactly like every
      // DEPARTMENT_INPUT BudgetLine's budgetYear amount would start at its
      // own valid prior-year reference), otherwise 0 - the user then edits
      // it directly on this BudgetVersion, never through the per-account
      // line API.
      priorYearHeadcount,
      budgetYearHeadcount: priorYearHeadcount ?? 0,
      // Set explicitly to the same JS Date used for every line's
      // createdAt/updatedAt above, rather than relying on
      // @default(now())/@updatedAt (evaluated by Postgres at insert time,
      // not this Node process) - otherwise lastPreparedAt below would never
      // exactly equal createdAt, just be very close to it.
      createdAt,
      updatedAt: createdAt,
      // 最後一次編製日期 starts at draft creation, the same instant as
      // createdAt/updatedAt above - see the schema comment on
      // BudgetVersion.lastPreparedAt for why this is never `updatedAt`
      // going forward (only their starting value is shared).
      lastPreparedAt: createdAt,
      // TEST_BYPASS_USER is a virtual identity never written to the User
      // table (see lib/auth/testBypass.ts), so its sentinel id must never
      // be written into this real foreign key - recorded as NULL here,
      // exactly as writeAuditLog() already does for actorUserId.
      preparedById: isTestBypassUser(user) ? null : user.id,
    },
  });
  const linesCreateManyQuery = prisma.budgetLine.createMany({ data: lineRows });
  const auditLogQuery = prisma.auditLog.create({
    data: buildAuditLogData({
      actorUserId: user.id,
      action: "BUDGET_VERSION_CREATED",
      entityType: "BudgetVersion",
      entityId: versionId,
      afterData: { departmentId, fiscalYear, forceEditable },
    }),
  });

  try {
    const [version] = await prisma.$transaction([versionCreateQuery, linesCreateManyQuery, auditLogQuery]);
    return version;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Race: another request created the same department/fiscalYear/
      // versionNumber=1 draft between the pre-check above and this write -
      // the @@unique([departmentId, fiscalYear, versionNumber]) constraint
      // caught it. Surface the same clear conflict message as the
      // pre-check (never a raw database error), and because this whole
      // write is one atomic batch, nothing from it was left behind - not a
      // duplicate version, not orphaned lines.
      throw new ApiError(409, "此部門年度預算草稿已存在");
    }
    throw err;
  }
}

export async function updateDepartmentInputLine(
  user: CurrentUser,
  versionId: string,
  lineId: string,
  input: { nextYearTargetExcludingNew: string; nextYearNewHireBudget: string; justification?: string | null }
) {
  await requireCapability(user, "budget.edit_own_department");

  return prisma.$transaction(async (tx) => {
    const version = await tx.budgetVersion.findUnique({ where: { id: versionId } });
    if (!version) throw new ApiError(404, "找不到此預算版本");
    await requireDepartmentAccess(user, version.departmentId);

    if (!isEditable(version.status)) {
      throw new ApiError(409, "送出後填報人不得直接修改，必須由財務退回後才能修改");
    }

    const line = await tx.budgetLine.findUnique({ where: { id: lineId } });
    if (!line || line.budgetVersionId !== versionId) throw new ApiError(404, "找不到此科目資料");
    if (line.isLocked) {
      throw new ApiError(422, "此科目為公式計算或不編列科目，不可手動修改");
    }

    const excludingNew = new Decimal(input.nextYearTargetExcludingNew || "0");
    const newHire = new Decimal(input.nextYearNewHireBudget || "0");
    if (isNegative(excludingNew) || isNegative(newHire)) {
      throw new ApiError(422, "金額不可為負數");
    }

    const derived = deriveLineTotals({
      priorYearOriginalBudget: line.priorYearOriginalBudget,
      nextYearTargetExcludingNew: excludingNew,
      nextYearNewHireBudget: newHire,
    });

    // undefined = caller didn't touch this field, leave as-is; "" (after
    // trim) = explicitly cleared; anything else = the new note. Users may
    // only ever change the 2026 amount and this note - never the account
    // name/code/category, which come solely from master data.
    const trimmedJustification = input.justification?.trim();
    const justification = input.justification === undefined ? undefined : trimmedJustification === "" ? null : trimmedJustification;

    // 最後一次編製日期 only moves when a stored value actually changes -
    // clicking into and back out of a field (or re-saving the same figure)
    // must not bump it. Decimal comparison via .equals() (not string/toString
    // equality, which could false-negative on e.g. "0" vs "0.00").
    const hasContentChanged =
      !excludingNew.equals(line.nextYearTargetExcludingNew) ||
      !newHire.equals(line.nextYearNewHireBudget) ||
      (justification !== undefined && justification !== line.justification);

    // TEST_BYPASS_USER is never written to the User table (see
    // lib/auth/testBypass.ts) - inputConfirmedById is a real foreign key,
    // so its sentinel id must never be written into it (mirrors
    // preparedById/submittedById elsewhere).
    const confirmingUserId = isTestBypassUser(user) ? null : user.id;
    const confirmedAt = new Date();

    const updated = await tx.budgetLine.update({
      where: { id: lineId },
      data: {
        nextYearTargetExcludingNew: excludingNew,
        nextYearNewHireBudget: newHire,
        nextYearTotal: derived.nextYearTotal,
        growthRateExcludingNew: derived.growthRateExcludingNew,
        growthRateIncludingNew: derived.growthRateIncludingNew,
        justification,
        // Set unconditionally on every successful save reaching this
        // point - not gated on hasContentChanged. This function is only
        // ever invoked by a genuine user save action (never by seed,
        // migration, or any batch-fix script - see schema.prisma's doc
        // comment on inputConfirmedAt), so "the user submitted this form"
        // is itself the confirmation, independent of whether the value
        // happens to equal what was already stored. This is deliberate:
        // an untouched line's amount already defaults to 0 at the DB
        // layer, so a user explicitly entering "0" would otherwise compare
        // equal to the existing value and never get marked confirmed under
        // a change-gated rule - exactly the "使用者輸入0元必須被視為使用者
        // 已確認的有效值" requirement this field exists to satisfy.
        inputConfirmedAt: confirmedAt,
        inputConfirmedById: confirmingUserId,
      },
    });

    if (hasContentChanged) {
      await tx.budgetVersion.update({
        where: { id: versionId },
        data: {
          lastPreparedAt: confirmedAt,
          // A version previously marked "完成編製" (preparationCompletedAt)
          // is no longer accurate the moment any line's content actually
          // changes - clear both fields so the derived progress status
          // drops back out of READY_TO_SUBMIT until the preparer re-runs
          // completePreparation. Only cleared on a REAL content change
          // (hasContentChanged), never on a no-op re-save, so re-opening
          // and re-saving an unchanged value does not spuriously undo a
          // completed mark.
          preparationCompletedAt: null,
          preparationCompletedById: null,
        },
      });
    }

    await writeAuditLog(
      {
        actorUserId: user.id,
        action: "BUDGET_LINE_UPDATED",
        entityType: "BudgetLine",
        entityId: lineId,
        beforeData: {
          nextYearTargetExcludingNew: line.nextYearTargetExcludingNew.toString(),
          nextYearNewHireBudget: line.nextYearNewHireBudget.toString(),
          justification: line.justification,
          inputConfirmedAt: line.inputConfirmedAt?.toISOString() ?? null,
        },
        afterData: {
          nextYearTargetExcludingNew: updated.nextYearTargetExcludingNew.toString(),
          nextYearNewHireBudget: updated.nextYearNewHireBudget.toString(),
          justification: updated.justification,
          inputConfirmedAt: updated.inputConfirmedAt?.toISOString() ?? null,
        },
      },
      tx as Prisma.TransactionClient
    );

    return updated;
  });
}

/**
 * "完成編製" (complete preparation): the preparer explicitly marks this
 * DRAFT/RETURNED/ADJUSTMENT_PENDING version as ready to submit, provided
 * every editable line has actually been confirmed (inputConfirmedAt set -
 * a locked/non-editable line, e.g. FORMULA/NOT_BUDGETED, is exempt since
 * the preparer was never shown an input for it) and the department
 * headcount has been confirmed too. This is the ONLY place
 * preparationCompletedAt/preparationCompletedById are ever set - never by
 * seed, migration, or implicitly from status alone - so
 * READY_TO_SUBMIT (status still DRAFT, this field set) is a real,
 * human-asserted milestone, not a guess.
 *
 * See updateDepartmentInputLine/updateBudgetYearHeadcount for where this
 * mark gets cleared again the moment real content changes after being set.
 */
export async function completePreparation(user: CurrentUser, versionId: string) {
  await requireCapability(user, "budget.edit_own_department");

  return prisma.$transaction(async (tx) => {
    const version = await tx.budgetVersion.findUnique({ where: { id: versionId }, include: { lines: true } });
    if (!version) throw new ApiError(404, "找不到此預算版本");
    await requireDepartmentAccess(user, version.departmentId);

    if (!isEditable(version.status)) {
      throw new ApiError(409, "此預算版本目前狀態不允許執行「完成編製」");
    }

    if (version.headcountConfirmedAt === null) {
      throw new ApiError(422, "部門人數尚未確認，請先於畫面確認 2026 年度部門人數後再完成編製");
    }

    const unconfirmedEditableLines = version.lines.filter((l) => !l.isLocked && l.inputConfirmedAt === null);
    if (unconfirmedEditableLines.length > 0) {
      throw new ApiError(
        422,
        `尚有 ${unconfirmedEditableLines.length} 個科目尚未輸入或確認金額，無法完成編製；請先逐一填寫或明確輸入 0 元後再試`
      );
    }

    const confirmingUserId = isTestBypassUser(user) ? null : user.id;
    const now = new Date();
    const updated = await tx.budgetVersion.update({
      where: { id: versionId },
      data: { preparationCompletedAt: now, preparationCompletedById: confirmingUserId },
    });

    await writeAuditLog(
      {
        actorUserId: user.id,
        action: "BUDGET_PREPARATION_COMPLETED",
        entityType: "BudgetVersion",
        entityId: versionId,
        beforeData: { preparationCompletedAt: null },
        afterData: { preparationCompletedAt: updated.preparationCompletedAt?.toISOString() ?? null },
      },
      tx as Prisma.TransactionClient
    );

    return updated;
  });
}
