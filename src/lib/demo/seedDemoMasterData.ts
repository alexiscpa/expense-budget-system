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
 */
export async function seedDemoMasterData(actorUserId: string | null): Promise<DemoSeedResult> {
  assertBypassEnabled();

  const { department, accounts, legacyRetired } = await prisma.$transaction(async (tx) => {
    // --- Legacy cleanup: retire (never delete) the old placeholder data --
    const legacyAccounts: string[] = [];
    for (const code of LEGACY_DEMO_ACCOUNT_CODES) {
      const existing = await tx.account.findUnique({ where: { code } });
      if (existing && existing.isActive) {
        await tx.account.update({
          where: { code },
          data: {
            isActive: false,
            name: `${existing.name}（已停用，已由 17203 財務管理處測試資料取代）`,
          },
        });
        legacyAccounts.push(code);
      }
    }
    const legacyDepartments: string[] = [];
    const existingLegacyDept = await tx.department.findUnique({ where: { code: LEGACY_DEMO_DEPARTMENT_CODE } });
    if (existingLegacyDept && existingLegacyDept.isActive) {
      await tx.department.update({
        where: { code: LEGACY_DEMO_DEPARTMENT_CODE },
        data: {
          isActive: false,
          notes: `${existingLegacyDept.notes ?? ""} 已停用，已由 17203 財務管理處測試資料取代。`.trim(),
        },
      });
      legacyDepartments.push(LEGACY_DEMO_DEPARTMENT_CODE);
    }

    // --- Real department + 62 detail accounts -----------------------------
    const department = await tx.department.upsert({
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

    const accounts = [];
    for (const item of DEMO_ACCOUNTS) {
      const account = await tx.account.upsert({
        where: { code: item.code },
        update: {
          name: item.name,
          majorCategory: DEMO_DEPARTMENT_CLASS,
          commonCategory: item.commonCategory,
          entryType: "DEPARTMENT_INPUT",
          formulaKey: null,
          isActive: true,
          isProvisionalCode: true,
          sourceSeq: item.seq,
          sourceRef: demoSourceRef(item.seq),
          priorYearReferenceAmount: item.priorYearReferenceAmount,
        },
        create: {
          code: item.code,
          name: item.name,
          majorCategory: DEMO_DEPARTMENT_CLASS,
          commonCategory: item.commonCategory,
          entryType: "DEPARTMENT_INPUT",
          formulaKey: null,
          isProvisionalCode: true,
          sourceSeq: item.seq,
          sourceRef: demoSourceRef(item.seq),
          priorYearReferenceAmount: item.priorYearReferenceAmount,
        },
      });
      accounts.push(account);
    }

    return { department, accounts, legacyRetired: { departments: legacyDepartments, accounts: legacyAccounts } };
  });

  const priorYearReferenceTotal = sumDecimals(accounts.map((a) => a.priorYearReferenceAmount)).toString();

  await writeAuditLog({
    actorUserId,
    action: "DEMO_MASTER_DATA_SEEDED",
    entityType: "DemoSeed",
    entityId: department.id,
    afterData: {
      departmentCode: department.code,
      accountCount: accounts.length,
      fiscalYear: DEMO_FISCAL_YEAR,
      priorYearReferenceTotal,
      legacyRetired,
    },
  });

  return {
    department: { id: department.id, code: department.code, name: department.name },
    accounts: accounts
      .map((a) => ({ id: a.id, code: a.code, name: a.name, seq: a.sourceSeq ?? 0 }))
      .sort((a, b) => a.seq - b.seq),
    fiscalYear: DEMO_FISCAL_YEAR,
    accountCount: accounts.length,
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
