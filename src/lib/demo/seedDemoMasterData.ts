import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isAuthBypassEnabled } from "@/lib/env";
import { ApiError } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/log";
import { sumDecimals } from "@/lib/money/decimal";
import {
  DEMO_DEPARTMENT_CODE,
  DEMO_DEPARTMENT_NAME,
  DEMO_DEPARTMENT_CLASS,
  DEMO_DEPARTMENT_PRIOR_YEAR_HEADCOUNT,
  DEMO_FISCAL_YEAR,
  DEMO_ACCOUNTS,
  DEMO_ACCOUNT_COUNT,
  LEGACY_DEMO_DEPARTMENT_CODE,
  LEGACY_DEMO_ACCOUNT_CODES,
  demoSourceRef,
  demoAccountCode,
} from "./constants";

export interface DemoSeedResult {
  department: { id: string; code: string; name: string };
  accounts: { id: string; code: string; name: string; seq: number }[];
  fiscalYear: number;
  accountCount: number;
  priorYearReferenceTotal: string;
  legacyRetired: { departments: string[]; accounts: string[] };
}

function assertBypassEnabled(): void {
  if (!isAuthBypassEnabled()) {
    throw new ApiError(403, "此功能僅限 Vercel Preview 測試環境（AUTH_DISABLED=true）使用");
  }
}

interface AccountUpsertRow {
  id: string;
  code: string;
  name: string;
  sourceSeq: number | null;
  priorYearReferenceAmount: Prisma.Decimal | string | null;
}

/**
 * Creates (or confirms, if already present) the DEMO/TEST master data for
 * hand-building a test budget through the screen: the real 財務管理處
 * (17203) department and its 62 detail expense accounts sourced from
 * docs-provided spreadsheet data (see constants.ts for provenance). Never
 * creates a BudgetVersion/BudgetLine or any 2026 budget amount - those must
 * be entered by hand on the budget screen (see BudgetVersionClient.tsx).
 *
 * Idempotent by design: upserts on the unique `sourceSeq` (the Excel A欄
 * 序號, stable across code changes) rather than on `code` itself, so calling
 * this repeatedly never produces duplicate rows - including the one-time
 * upgrade from the retired FIN-<seq> provisional codes to the real Excel
 * A欄 序號 as `code` (see demoAccountCode()): a row already seeded under the
 * old FIN-003-style code is matched by its unchanged sourceSeq and has its
 * `code`/`isProvisionalCode` updated in place, never re-created under a new
 * id. Also safely retires (deactivates, never deletes) any rows left over
 * from the earlier DEMO-DEPT/DEMO-ACC-* placeholder data, so re-running
 * this after upgrading from that version converges a Preview database to
 * exactly the 62 real accounts without requiring a separate manual cleanup
 * step. Only ever touches rows matching those specific legacy codes or this
 * function's own DEMO_ACCOUNTS/DEMO_DEPARTMENT_CODE - never any other
 * master data.
 *
 * `code` remains @unique, so if the real Excel 序號 for one of these
 * accounts were ever to collide with a *different* account's existing code
 * (not itself - matched separately by sourceSeq), the whole batch is rolled
 * back (see the catch block below) and a clear 繁體中文 error is thrown
 * rather than a raw Postgres constraint error.
 *
 * Gated on isAuthBypassEnabled() (fail-closed, Preview-only - see
 * lib/env.ts), so this can never run in Production and is never reachable
 * outside Preview+AUTH_DISABLED=true. Must only ever be invoked from a
 * user-triggered API request (see app/api/demo/seed/route.ts) - never from
 * a build step, postinstall script, or module top-level code.
 *
 * Performance note: this used to upsert the 62 accounts one row at a time
 * inside an interactive `prisma.$transaction(async (tx) => ...)` callback -
 * each awaited query round-trips Node -> Neon over the network, and Neon's
 * serverless latency pushed the ~130 sequential round trips (62 accounts x
 * up to 2 statements each, plus the legacy-cleanup lookups) past Prisma's
 * 5-second interactive-transaction timeout, surfacing as P2028 ("Transaction
 * already closed"). The whole operation below is now exactly 4 statements -
 * 2 bulk legacy-retirement UPDATEs, 1 department upsert, and 1 multi-row
 * account UPSERT built with a single parameterized INSERT ... VALUES ...
 * ON CONFLICT DO UPDATE - sent together as a non-interactive Prisma batch
 * transaction (the `$transaction([...])` array form). That form has no
 * client-side timeout to exceed in the first place (Prisma only imposes the
 * 5s/2s default timeout/maxWait on the interactive callback form), and with
 * only 4 real round trips even a slow Neon connection has ample headroom.
 */
export async function seedDemoMasterData(actorUserId: string | null): Promise<DemoSeedResult> {
  assertBypassEnabled();

  const legacyAccountRetireQuery = prisma.$queryRaw<{ code: string }[]>`
    UPDATE "Account"
    SET "isActive" = false,
        "name" = "name" || '（已停用，已由 17203 財務管理處測試資料取代）'
    WHERE "code" IN (${Prisma.join(LEGACY_DEMO_ACCOUNT_CODES)}) AND "isActive" = true
    RETURNING "code"
  `;

  const legacyDepartmentRetireQuery = prisma.$queryRaw<{ code: string }[]>`
    UPDATE "Department"
    SET "isActive" = false,
        "notes" = TRIM(COALESCE("notes", '') || ' 已停用，已由 17203 財務管理處測試資料取代。')
    WHERE "code" = ${LEGACY_DEMO_DEPARTMENT_CODE} AND "isActive" = true
    RETURNING "code"
  `;

  const departmentUpsertQuery = prisma.department.upsert({
    where: { code: DEMO_DEPARTMENT_CODE },
    update: {
      name: DEMO_DEPARTMENT_NAME,
      class: DEMO_DEPARTMENT_CLASS,
      isActive: true,
      priorYearHeadcount: DEMO_DEPARTMENT_PRIOR_YEAR_HEADCOUNT,
    },
    create: {
      code: DEMO_DEPARTMENT_CODE,
      name: DEMO_DEPARTMENT_NAME,
      class: DEMO_DEPARTMENT_CLASS,
      priorYearHeadcount: DEMO_DEPARTMENT_PRIOR_YEAR_HEADCOUNT,
      notes:
        "Preview 測試環境使用的真實部門識別（財務管理處），科目明細來源見各科目 sourceRef。2026 預算金額須由使用者於畫面親自輸入，非正式送審資料。",
    },
  });

  // One multi-row INSERT ... ON CONFLICT DO UPDATE for all 62 accounts,
  // instead of 62 individual upserts. `id` is only used when inserting a
  // brand-new row - on conflict the existing row's id is left untouched
  // (it is deliberately absent from the DO UPDATE SET list below). The
  // conflict target is `sourceSeq` (the stable Excel A欄 序號), not `code`:
  // `code` is exactly what this upsert needs to be able to change (the
  // FIN-<seq> -> plain 序號 migration) without losing the existing row, so
  // it cannot also be what identifies "the same row" across that change.
  const accountValueRows = Prisma.join(
    DEMO_ACCOUNTS.map(
      (item) => Prisma.sql`(
        ${randomUUID()}, ${demoAccountCode(item.seq)}, ${item.name},
        ${DEMO_DEPARTMENT_CLASS}::"DeptClass", ${item.commonCategory}::"AccountCommonCategory",
        'DEPARTMENT_INPUT'::"AccountEntryType", true, false,
        ${item.seq}, ${demoSourceRef(item.seq)}, ${item.priorYearReferenceAmount}::numeric,
        now(), now()
      )`
    )
  );

  const accountUpsertQuery = prisma.$queryRaw<AccountUpsertRow[]>`
    INSERT INTO "Account" (
      "id", "code", "name",
      "majorCategory", "commonCategory",
      "entryType", "isActive", "isProvisionalCode",
      "sourceSeq", "sourceRef", "priorYearReferenceAmount",
      "createdAt", "updatedAt"
    )
    VALUES ${accountValueRows}
    ON CONFLICT ("sourceSeq") DO UPDATE SET
      "code" = EXCLUDED."code",
      "name" = EXCLUDED."name",
      "majorCategory" = EXCLUDED."majorCategory",
      "commonCategory" = EXCLUDED."commonCategory",
      "entryType" = EXCLUDED."entryType",
      "formulaKey" = NULL,
      "isActive" = true,
      "isProvisionalCode" = false,
      "sourceRef" = EXCLUDED."sourceRef",
      "priorYearReferenceAmount" = EXCLUDED."priorYearReferenceAmount",
      "updatedAt" = now()
    RETURNING "id", "code", "name", "sourceSeq", "priorYearReferenceAmount"
  `;

  // Non-interactive ("batch") transaction: all 4 statements are sent
  // together and committed atomically by the query engine without any
  // Node.js round trip in between, so a partial failure (e.g. a bad row)
  // rolls back everything - never leaving a half-seeded master data set -
  // and there is no interactive-transaction timeout to tune or exceed.
  let legacyAccountRows: { code: string }[];
  let legacyDepartmentRows: { code: string }[];
  let department: { id: string; code: string; name: string };
  let accountRows: AccountUpsertRow[];
  try {
    [legacyAccountRows, legacyDepartmentRows, department, accountRows] = await prisma.$transaction([
      legacyAccountRetireQuery,
      legacyDepartmentRetireQuery,
      departmentUpsertQuery,
      accountUpsertQuery,
    ]);
  } catch (err) {
    // Raw-SQL unique-violation on "code" (Postgres error 23505 on the
    // Account_code_key index) surfaces from $queryRaw as Prisma error code
    // P2010 ("Raw query failed"), with the underlying Postgres error
    // (code + "Key (code)=(...) already exists." message) in `meta`. This
    // can only mean the new Excel-序號-based code for one account collided
    // with a *different* account's existing code (the row being upserted
    // itself is matched by sourceSeq, not code - see the ON CONFLICT target
    // above). The whole batch transaction has already been rolled back by
    // Postgres at this point (never a partial write) - surface a clear
    // 繁體中文 error instead of the raw constraint message.
    const meta = err instanceof Prisma.PrismaClientKnownRequestError ? (err.meta as { code?: string; message?: string } | undefined) : undefined;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2010" && meta?.code === "23505" && meta.message?.includes("(code)")) {
      throw new ApiError(
        409,
        "科目編號更新失敗：新的科目編號（來源 Excel 序號）與現有其他科目的編號衝突，本次初始化已完整回滾，未異動任何資料，請聯絡系統管理員確認科目主檔"
      );
    }
    throw err;
  }

  if (accountRows.length !== DEMO_ACCOUNT_COUNT) {
    // Fail loudly rather than silently returning a truncated/duplicated
    // account list - this would indicate the constants file and this
    // function's expectations have drifted apart, not a condition to paper
    // over with a partial result.
    throw new ApiError(
      500,
      `DEMO 主檔初始化異常：預期建立/更新 ${DEMO_ACCOUNT_COUNT} 筆科目，實際回傳 ${accountRows.length} 筆，請聯絡系統管理員`
    );
  }

  const legacyRetired = {
    departments: legacyDepartmentRows.map((r) => r.code),
    accounts: legacyAccountRows.map((r) => r.code),
  };

  const priorYearReferenceTotal = sumDecimals(accountRows.map((a) => a.priorYearReferenceAmount)).toString();

  await writeAuditLog({
    actorUserId,
    action: "DEMO_MASTER_DATA_SEEDED",
    entityType: "DemoSeed",
    entityId: department.id,
    afterData: {
      departmentCode: department.code,
      accountCount: accountRows.length,
      fiscalYear: DEMO_FISCAL_YEAR,
      priorYearReferenceTotal,
      legacyRetired,
    },
  });

  return {
    department: { id: department.id, code: department.code, name: department.name },
    accounts: accountRows
      .map((a) => ({ id: a.id, code: a.code, name: a.name, seq: a.sourceSeq ?? 0 }))
      .sort((a, b) => a.seq - b.seq),
    fiscalYear: DEMO_FISCAL_YEAR,
    accountCount: accountRows.length,
    priorYearReferenceTotal,
    legacyRetired,
  };
}

/** Read-only check for whether the DEMO master data already exists - used to render dashboard status without creating anything. */
export async function getDemoSeedStatus(): Promise<DemoSeedResult | null> {
  assertBypassEnabled();

  const department = await prisma.department.findUnique({ where: { code: DEMO_DEPARTMENT_CODE } });
  if (!department) return null;

  const accounts = await prisma.account.findMany({
    where: { sourceSeq: { in: DEMO_ACCOUNTS.map((a) => a.seq) } },
    orderBy: { sourceSeq: "asc" },
  });

  const priorYearReferenceTotal = sumDecimals(accounts.map((a) => a.priorYearReferenceAmount)).toString();

  return {
    department: { id: department.id, code: department.code, name: department.name },
    accounts: accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, seq: a.sourceSeq ?? 0 })),
    fiscalYear: DEMO_FISCAL_YEAR,
    accountCount: accounts.length,
    priorYearReferenceTotal,
    legacyRetired: { departments: [], accounts: [] },
  };
}

export { DEMO_ACCOUNT_COUNT };
