import { prisma } from "@/lib/prisma";
import { isAuthBypassEnabled } from "@/lib/env";
import { ApiError } from "@/lib/rbac/guard";
import { writeAuditLog } from "@/lib/audit/log";
import { DEMO_DEPARTMENT_CODE, DEMO_DEPARTMENT_NAME, DEMO_FISCAL_YEAR, DEMO_ACCOUNTS } from "./constants";

export interface DemoSeedResult {
  department: { id: string; code: string; name: string };
  accounts: { id: string; code: string; name: string }[];
  fiscalYear: number;
}

function assertBypassEnabled(): void {
  if (!isAuthBypassEnabled()) {
    throw new ApiError(403, "此功能僅限 Vercel Preview 測試環境（AUTH_DISABLED=true）使用");
  }
}

/**
 * Creates (or confirms, if already present) the minimal DEMO/TEST master
 * data needed to hand-build a test budget through the screen: one DEMO
 * department and three general-expense DEMO accounts. Never creates a
 * BudgetVersion/BudgetLine or any budget amount - those must be entered by
 * hand on the budget screen (see BudgetVersionClient.tsx).
 *
 * Idempotent by design: upserts on the unique DEMO-prefixed codes, so
 * calling this repeatedly never produces duplicate rows and only ever
 * touches its own DEMO- rows, never any other master data.
 *
 * Gated on isAuthBypassEnabled() (fail-closed, Preview-only - see
 * lib/env.ts), so this can never run in Production and is never reachable
 * outside Preview+AUTH_DISABLED=true. Must only ever be invoked from a
 * user-triggered API request (see app/api/demo/seed/route.ts) - never from
 * a build step, postinstall script, or module top-level code.
 */
export async function seedDemoMasterData(actorUserId: string | null): Promise<DemoSeedResult> {
  assertBypassEnabled();

  const { department, accounts } = await prisma.$transaction(async (tx) => {
    const department = await tx.department.upsert({
      where: { code: DEMO_DEPARTMENT_CODE },
      update: {},
      create: {
        code: DEMO_DEPARTMENT_CODE,
        name: DEMO_DEPARTMENT_NAME,
        // UNCLASSIFIED is excluded from the real four-category (P/R/S/M)
        // rollups (see schema.prisma) - keeps DEMO data out of any real
        // aggregate report.
        class: "UNCLASSIFIED",
        notes: "DEMO／TEST 專用測試主檔，僅供 Preview 環境操作示範，禁止輸入正式資料，不得視為正式部門。",
      },
    });

    const accounts = [];
    for (const acc of DEMO_ACCOUNTS) {
      const account = await tx.account.upsert({
        where: { code: acc.code },
        update: {},
        create: {
          code: acc.code,
          name: acc.name,
          majorCategory: "UNCLASSIFIED",
          commonCategory: "OTHER",
          entryType: "DEPARTMENT_INPUT",
          formulaKey: null,
        },
      });
      accounts.push(account);
    }

    return { department, accounts };
  });

  await writeAuditLog({
    actorUserId,
    action: "DEMO_MASTER_DATA_SEEDED",
    entityType: "DemoSeed",
    entityId: department.id,
    afterData: {
      departmentCode: department.code,
      accountCodes: accounts.map((a) => a.code),
      fiscalYear: DEMO_FISCAL_YEAR,
    },
  });

  return {
    department: { id: department.id, code: department.code, name: department.name },
    accounts: accounts.map((a) => ({ id: a.id, code: a.code, name: a.name })),
    fiscalYear: DEMO_FISCAL_YEAR,
  };
}

/** Read-only check for whether the DEMO master data already exists - used to render dashboard status without creating anything. */
export async function getDemoSeedStatus(): Promise<DemoSeedResult | null> {
  assertBypassEnabled();

  const department = await prisma.department.findUnique({ where: { code: DEMO_DEPARTMENT_CODE } });
  if (!department) return null;

  const accounts = await prisma.account.findMany({
    where: { code: { in: DEMO_ACCOUNTS.map((a) => a.code) } },
    orderBy: { code: "asc" },
  });

  return {
    department: { id: department.id, code: department.code, name: department.name },
    accounts: accounts.map((a) => ({ id: a.id, code: a.code, name: a.name })),
    fiscalYear: DEMO_FISCAL_YEAR,
  };
}
