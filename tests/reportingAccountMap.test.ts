import { describe, it, expect } from "vitest";
import {
  SGA_REPORTING_ACCOUNTS,
  PRODUCTION_REPORTING_ACCOUNTS,
  findReportingAccount,
  isMappedAccountCode,
} from "@/lib/reports/reportingAccountMap";

describe("reportingAccountMap - static, auditable Account.code -> 報表科目 mapping", () => {
  it("every SGA row carries exactly M/S/R source codes (no production codes leak in)", () => {
    expect(SGA_REPORTING_ACCOUNTS.length).toBeGreaterThan(0);
    for (const row of SGA_REPORTING_ACCOUNTS) {
      expect(row.sourceCodes.M).toBeTruthy();
      expect(row.sourceCodes.S).toBeTruthy();
      expect(row.sourceCodes.R).toBeTruthy();
      expect(row.sourceCodes.P).toBeUndefined();
    }
  });

  it("every PRODUCTION row carries only a P source code", () => {
    expect(PRODUCTION_REPORTING_ACCOUNTS.length).toBeGreaterThan(0);
    for (const row of PRODUCTION_REPORTING_ACCOUNTS) {
      expect(row.sourceCodes.P).toBeTruthy();
      expect(row.sourceCodes.M).toBeUndefined();
      expect(row.sourceCodes.S).toBeUndefined();
      expect(row.sourceCodes.R).toBeUndefined();
    }
  });

  it("SGA and PRODUCTION reportingAccountKeys never collide with each other", () => {
    const sgaKeys = new Set(SGA_REPORTING_ACCOUNTS.map((r) => r.reportingAccountKey));
    const prodKeys = new Set(PRODUCTION_REPORTING_ACCOUNTS.map((r) => r.reportingAccountKey));
    for (const k of sgaKeys) expect(prodKeys.has(k)).toBe(false);
  });

  it("SGA and PRODUCTION source account codes never overlap (independent code systems)", () => {
    const sgaCodes = new Set(SGA_REPORTING_ACCOUNTS.flatMap((r) => Object.values(r.sourceCodes)));
    const prodCodes = new Set(PRODUCTION_REPORTING_ACCOUNTS.flatMap((r) => Object.values(r.sourceCodes)));
    for (const c of sgaCodes) expect(prodCodes.has(c)).toBe(false);
  });

  it("reportingAccountKey is unique within each scope (no duplicate rows)", () => {
    const sgaKeys = SGA_REPORTING_ACCOUNTS.map((r) => r.reportingAccountKey);
    expect(new Set(sgaKeys).size).toBe(sgaKeys.length);
    const prodKeys = PRODUCTION_REPORTING_ACCOUNTS.map((r) => r.reportingAccountKey);
    expect(new Set(prodKeys).size).toBe(prodKeys.length);
  });

  it("order is a dense 1..N sequence within each scope, matching the source row order", () => {
    const sgaOrders = SGA_REPORTING_ACCOUNTS.map((r) => r.order).sort((a, b) => a - b);
    expect(sgaOrders).toEqual(Array.from({ length: SGA_REPORTING_ACCOUNTS.length }, (_, i) => i + 1));
    const prodOrders = PRODUCTION_REPORTING_ACCOUNTS.map((r) => r.order).sort((a, b) => a - b);
    expect(prodOrders).toEqual(Array.from({ length: PRODUCTION_REPORTING_ACCOUNTS.length }, (_, i) => i + 1));
  });

  it("薪資支出 merges 6110010 (M) / 6210010 (S) / 6310010 (R) into one reportingAccountKey", () => {
    const row = SGA_REPORTING_ACCOUNTS.find((r) => r.reportingAccountName === "薪資支出" && r.sourceCodes.M === "6110010");
    expect(row).toBeTruthy();
    expect(row!.sourceCodes).toEqual({ M: "6110010", S: "6210010", R: "6310010" });

    // Every one of the three codes resolves back to the SAME reportingAccountKey via findReportingAccount.
    const viaM = findReportingAccount("6110010", "SGA");
    const viaS = findReportingAccount("6210010", "SGA");
    const viaR = findReportingAccount("6310010", "SGA");
    expect(viaM?.reportingAccountKey).toBe(row!.reportingAccountKey);
    expect(viaS?.reportingAccountKey).toBe(row!.reportingAccountKey);
    expect(viaR?.reportingAccountKey).toBe(row!.reportingAccountKey);
  });

  it("findReportingAccount never falls back to a name match across scopes or codes", () => {
    // 財務管理處's own manually-created demo account uses code "3", also
    // named 薪資支出 - it must NOT resolve to the SGA 薪資支出 row just
    // because the names match (see reportingAccountMap.ts's own doc comment
    // for why this is the exact failure mode this table exists to prevent).
    expect(findReportingAccount("3", "SGA")).toBeUndefined();
    expect(findReportingAccount("3", "PRODUCTION")).toBeUndefined();
    expect(isMappedAccountCode("3")).toBe(false);
  });

  it("a production-only code is not found under the SGA scope, and vice versa", () => {
    expect(findReportingAccount("5310010", "SGA")).toBeUndefined(); // 直接人工-薪資, P only
    expect(findReportingAccount("6110010", "PRODUCTION")).toBeUndefined(); // 薪資支出 M/S/R, no P
  });

  it("isMappedAccountCode is true for any code appearing in either table", () => {
    expect(isMappedAccountCode("6110010")).toBe(true);
    expect(isMappedAccountCode("6210010")).toBe(true);
    expect(isMappedAccountCode("6310010")).toBe(true);
    expect(isMappedAccountCode("5310010")).toBe(true);
    expect(isMappedAccountCode("not-a-real-code")).toBe(false);
  });
});
