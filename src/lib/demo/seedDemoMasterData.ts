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
  DEMO_FISCAL_YEAR,
  DEMO_ACCOUNTS,
  DEMO_ACCOUNT_COUNT,
  LEGACY_DEMO_DEPARTMENT_CODE,
  LEGACY_DEMO_ACCOUNT_CODES,
  demoSourceRef,
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
 * Idempotent by design: upserts on unique codes, so calling this repeatedly
 * never produces duplicate rows. Also safely retires (deactivates, never
 * deletes) any rows left over from the earlier DEMO-DEPT/DEMO-ACC-*
 * placeholder data, so re-running this after upgrading from that version
 * converges a Preview database to exactly the 62 real accounts without
 * requiring a separate manual cleanup step. Only ever touches rows matching
 * those specific legacy codes or this function's own DEMO_ACCOUNTS/
 * DEMO_DEPARTMENT_CODE - never any other master data.
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
    update: { name: DEMO_DEPARTMENT_NAME, class: DEMO_DEPARTMENT_CLASS, isActive: true },
    create: {
      code: DEMO_DEPARTMENT_CODE,
      name: DEMO_DEPARTMENT_NAME,
      class: DEMO_DEPARTMENT_CLASS,
      notes:
        "Preview 測試環境使用的真實部門識別（財務管理處），科目明細來源見各科目 sourceRef。2026 預算金額須由使用者於畫面親自輸入，非正式送審資料。",
    },
  });

  // One multi-row INSERT ... ON CONFLICT DO UPDATE for all 62 accounts,
  // instead of 62 individual upserts. `id` is only used when inserting a
  // brand-new row - on conflict the existing row's id is left untouched
  // (it is deliberately absent from the DO UPDATE SET list below), so this
  // stays a pure upsert-by-code exactly like the previous per-row version.
  const accountValueRows = Prisma.join(
    DEMO_ACCOUNTS.map(
      (item) => Prisma.sql`(
        ${randomUUID()}, ${item.code}, ${item.name},
        ${DEMO_DEPARTMENT_CLASS}::"DeptClass", ${item.commonCategory}::"AccountCommonCategory",
        'DEPARTMENT_INPUT'::"AccountEntryType", true, true,
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
    ON CONFLICT ("code") DO UPDATE SET
      "name" = EXCLUDED."name",
      "majorCategory" = EXCLUDED."majorCategory",
      "commonCategory" = EXCLUDED."commonCategory",
      "entryType" = EXCLUDED."entryType",
      "formulaKey" = NULL,
      "isActive" = true,
      "isProvisionalCode" = true,
      "sourceSeq" = EXCLUDED."sourceSeq",
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
  const [legacyAccountRows, legacyDepartmentRows, department, accountRows] = await prisma.$transaction([
    legacyAccountRetireQuery,
    legacyDepartmentRetireQuery,
    departmentUpsertQuery,
    accountUpsertQuery,
  ]);

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
    where: { code: { in: DEMO_ACCOUNTS.map((a) => a.code) } },
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
