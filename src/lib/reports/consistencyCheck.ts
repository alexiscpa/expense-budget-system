import { prisma } from "@/lib/prisma";
import { sumDecimals, ZERO } from "@/lib/money/decimal";
import { writeAuditLog } from "@/lib/audit/log";
import type { CurrentUser } from "@/lib/auth/session";

/**
 * Core validation rule (docs/budget-system-spec-v0.4.md §5.1): the same set
 * of approved-year figures must sum to the same total whether aggregated by
 * department or by account. On mismatch this never silently reconciles the
 * two sides - it reports the discrepancy and marks the run as failed so the
 * summary is flagged 【待確認】instead of being treated as final.
 *
 * Runs over the latest LOCKED/ADJUSTED (i.e. officially approved) version
 * per department for the given fiscal year - draft/in-review data is
 * excluded, matching "正式報表只包含已核准版本".
 */
export async function runConsistencyCheck(user: CurrentUser | null, fiscalYear: number) {
  const versions = await prisma.budgetVersion.findMany({
    where: { fiscalYear, status: { in: ["LOCKED", "ADJUSTED"] } },
    include: { lines: true, department: true },
    orderBy: { versionNumber: "desc" },
  });

  // Keep only the latest official version per department.
  const latestByDept = new Map<string, (typeof versions)[number]>();
  for (const v of versions) {
    const existing = latestByDept.get(v.departmentId);
    if (!existing || v.versionNumber > existing.versionNumber) {
      latestByDept.set(v.departmentId, v);
    }
  }

  const departmentTotals: { departmentId: string; departmentName: string; total: string }[] = [];
  const accountTotalsMap = new Map<string, { accountCode: string; accountName: string; total: import("@/lib/money/decimal").Decimal }>();
  let grandTotal = ZERO;

  for (const version of latestByDept.values()) {
    const deptTotal = sumDecimals(version.lines.map((l) => l.nextYearTotal));
    departmentTotals.push({
      departmentId: version.departmentId,
      departmentName: version.department.name,
      total: deptTotal.toString(),
    });
    grandTotal = grandTotal.plus(deptTotal);

    for (const line of version.lines) {
      const account = await prisma.account.findUnique({ where: { id: line.accountId } });
      if (!account) continue;
      const existing = accountTotalsMap.get(account.code);
      const lineTotal = line.nextYearTotal;
      if (existing) {
        existing.total = existing.total.plus(lineTotal);
      } else {
        accountTotalsMap.set(account.code, { accountCode: account.code, accountName: account.name, total: lineTotal });
      }
    }
  }

  const accountGrandTotal = sumDecimals([...accountTotalsMap.values()].map((a) => a.total));
  const difference = grandTotal.minus(accountGrandTotal);
  const passed = difference.isZero();

  const run = await prisma.consistencyCheckRun.create({
    data: {
      fiscalYear,
      departmentTotal: grandTotal,
      accountTotal: accountGrandTotal,
      difference,
      passed,
      runByUserId: user?.id ?? null,
      detail: {
        departmentTotals,
        accountTotals: [...accountTotalsMap.values()].map((a) => ({ ...a, total: a.total.toString() })),
        message: passed
          ? "部門別加總與科目別加總一致"
          : `加總不符，差額 ${difference.toString()}，可能原因：某部門漏填或某科目金額被重複計算。目前彙總標示為【待確認】，不建議提交決策層，待財務確認差異原因後再重新產出正式版。`,
      } as never,
    },
  });

  if (user) {
    await writeAuditLog({
      actorUserId: user.id,
      action: "CONSISTENCY_CHECK_RUN",
      entityType: "ConsistencyCheckRun",
      entityId: run.id,
      afterData: { fiscalYear, passed, difference: difference.toString() },
    });
  }

  return run;
}
