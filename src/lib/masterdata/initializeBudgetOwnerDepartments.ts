import { randomUUID } from "crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "@/lib/auth/session";
import { isVercelProductionEnvironment } from "@/lib/env";
import { ApiError } from "@/lib/rbac/guard";
import { buildAuditLogData } from "@/lib/audit/log";
import { BUDGET_OWNER_ROSTER, type BudgetOwnerRosterEntry } from "./budgetOwnerRoster";

export interface InitializeBudgetOwnerDepartmentsResult {
  addedCodes: string[];
  existingCodes: string[];
  skippedCodes: { code: string; reason: string }[];
  conflicts: { code: string; reason: string }[];
  rosterSize: number;
}

function assertNotProduction(): void {
  if (isVercelProductionEnvironment()) {
    throw new ApiError(403, "此功能禁止在 Production 環境執行，部門主檔須以審慎流程另行匯入");
  }
}

/**
 * Idempotently creates a Department row for every one of the 45 authoritative
 * budget-owner codes (BUDGET_OWNER_ROSTER) that does not already exist,
 * WITHOUT touching any pre-existing Department row, without creating any
 * BudgetVersion/BudgetLine (2027 drafts are created lazily per-department
 * when a preparer clicks 開始編製 - see stage2bDraftService.ts), and without
 * fabricating any 2026 estimate: every newly created row leaves
 * priorYearHeadcount/priorYearReferenceFiscalYear null, exactly like any
 * other never-yet-confirmed reference figure elsewhere in this schema.
 *
 * Safety properties required by Stage 2B-2 §八:
 *  - Hard-blocked in Production (assertNotProduction) - callers in
 *    Preview/local dev must still separately require an explicit
 *    confirmation flag before invoking this (see the API route), since this
 *    function itself has no interactive confirmation step.
 *  - Idempotent: re-running with the same roster produces the same end
 *    state and never duplicates a row (departments are looked up by their
 *    unique `code`, and creation uses `skipDuplicates`).
 *  - Never overwrites existing data: an existing row's class/
 *    domesticOrOverseas/isActive/priorYearHeadcount/etc. are read-only here,
 *    never updated, regardless of whether they match the roster - see
 *    conflict handling below for the one case this refuses to silently
 *    paper over.
 *  - Never resets workflow state or deletes anything: this module contains
 *    no UPDATE/DELETE against Department, and touches no other table besides
 *    a single AuditLog row recording the run.
 *  - All 36-or-fewer new rows are created in one non-interactive
 *    `prisma.$transaction([...])` batch (the array form used throughout this
 *    codebase - see createBudgetVersionDraft/stage2aSeed.ts for the same
 *    P2028-avoidance rationale), so partial failure cannot leave a
 *    half-initialized roster.
 *  - Whole-batch rollback on conflict: classification happens BEFORE any
 *    write. If any existing row's `class` disagrees with the roster's
 *    expected class for that code (a real data contradiction - not simply
 *    "already exists"), this throws a clear, itemized ApiError and creates
 *    nothing at all, rather than creating the unaffected rows and silently
 *    ignoring the disputed one.
 */
export async function initializeBudgetOwnerDepartments(actor: CurrentUser): Promise<InitializeBudgetOwnerDepartmentsResult> {
  assertNotProduction();

  const codes = BUDGET_OWNER_ROSTER.map((r) => r.code);
  const existingRows = await prisma.department.findMany({
    where: { code: { in: codes } },
  });
  const existingByCode = new Map(existingRows.map((r) => [r.code, r]));

  const addedCodes: string[] = [];
  const existingCodes: string[] = [];
  const skippedCodes: { code: string; reason: string }[] = [];
  const conflicts: { code: string; reason: string }[] = [];
  const toCreate: BudgetOwnerRosterEntry[] = [];

  for (const entry of BUDGET_OWNER_ROSTER) {
    const existing = existingByCode.get(entry.code);
    if (!existing) {
      toCreate.push(entry);
      continue;
    }
    if (existing.class !== entry.class) {
      conflicts.push({
        code: entry.code,
        reason: `既有部門 class=${existing.class}，與名冊期望的 ${entry.class} 不符（既有資料未被修改，須人工核實後再重跑）`,
      });
      continue;
    }
    if (!existing.isActive) {
      // A real deactivated department must never be silently reactivated by
      // this batch-initializer - see Stage 2B-1's own precedent for 12501
      // (人工決定刪除／停用，不建立預算輸入表...) being deliberately kept
      // out of the roster. If a roster code's existing row happens to be
      // inactive, that is itself worth surfacing rather than treating as a
      // no-op "existing" match.
      skippedCodes.push({ code: entry.code, reason: "既有部門目前 isActive=false，本功能不會重新啟用，維持現狀" });
      continue;
    }
    existingCodes.push(entry.code);
  }

  if (conflicts.length > 0) {
    const detail = conflicts.map((c) => `${c.code}（${c.reason}）`).join("；");
    throw new ApiError(409, `偵測到 ${conflicts.length} 筆部門主檔衝突，整批未寫入任何資料：${detail}`);
  }

  if (toCreate.length > 0) {
    const now = new Date();
    const departmentRows: Prisma.DepartmentCreateManyInput[] = toCreate.map((entry) => ({
      id: `budget-owner-dept-${entry.code}`,
      code: entry.code,
      name: entry.name,
      class: entry.class,
      isActive: true,
      // Never a real-department seed - unlike Stage 2A's stress-test rows,
      // these are the actual production department roster (isTestData must
      // stay false so this batch is never treated as disposable test data
      // by any Stage 2A-specific cleanup/reporting logic).
      isTestData: false,
      domesticOrOverseas: entry.domesticOrOverseas,
      rollupParentCode: entry.rollupParentCode,
      isBudgetOwner: true,
      // Deliberately left null - see this function's own doc comment: no
      // 2026 estimate is ever fabricated for a newly-created department.
      priorYearHeadcount: null,
      priorYearReferenceFiscalYear: null,
      notes: null,
      createdAt: now,
      updatedAt: now,
    }));

    const auditLogQuery = prisma.auditLog.create({
      data: buildAuditLogData({
        actorUserId: actor.id,
        action: "BUDGET_OWNER_DEPARTMENTS_INITIALIZED",
        entityType: "Department",
        entityId: randomUUID(),
        afterData: {
          addedCodes: toCreate.map((e) => e.code),
          existingCodes,
          skippedCodes,
        },
      }),
    });

    const [createResult] = await prisma.$transaction([
      prisma.department.createMany({ data: departmentRows, skipDuplicates: true }),
      auditLogQuery,
    ]);
    if (createResult.count !== toCreate.length) {
      // createMany with skipDuplicates silently no-ops a row whose unique
      // `code` already exists - which should be impossible here since
      // toCreate was built from codes NOT found in existingByCode moments
      // earlier. Surfacing this loudly rather than reporting a false
      // "success" if a concurrent request created the same code in between.
      throw new ApiError(
        409,
        `部門主檔建立筆數（${createResult.count}）與預期（${toCreate.length}）不符，可能與另一次初始化執行發生競爭，請重新查詢現況後再試`
      );
    }
    addedCodes.push(...toCreate.map((e) => e.code));
  }

  return {
    addedCodes,
    existingCodes,
    skippedCodes,
    conflicts,
    rosterSize: BUDGET_OWNER_ROSTER.length,
  };
}
