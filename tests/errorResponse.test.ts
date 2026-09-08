import { describe, it, expect } from "vitest";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { errorResponse, ApiError } from "@/lib/rbac/guard";

describe("errorResponse - malformed input surfaces a clear Traditional-Chinese message, not a generic 500", () => {
  it("returns the zod schema's own message and a 422, not the generic 500 fallback", async () => {
    const schema = z.object({
      nextYearTargetExcludingNew: z.string().regex(/^\d+(\.\d{1,2})?$/, "請輸入正確的金額格式"),
    });
    const result = schema.safeParse({ nextYearTargetExcludingNew: "" });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");

    const response = errorResponse(result.error);
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe("請輸入正確的金額格式");
  });

  it("still returns the specific status/message for a known ApiError", async () => {
    const response = errorResponse(new ApiError(409, "此部門年度預算草稿已存在"));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("此部門年度預算草稿已存在");
  });

  it("falls back to a generic message (never a raw stack trace or DB error) for anything else", async () => {
    const response = errorResponse(new Error("password=hunter2 at /internal/db/query.ts:42"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe("系統發生錯誤，請稍後再試");
    expect(JSON.stringify(body)).not.toContain("hunter2");
    expect(JSON.stringify(body)).not.toContain(".ts:42");
  });

  it("maps a Prisma P2028 ('Transaction already closed') to a clear Traditional-Chinese, traceable-by-code message - not a generic 500", async () => {
    const err = new Prisma.PrismaClientKnownRequestError("Transaction already closed: Could not perform operation.", {
      code: "P2028",
      clientVersion: "5.20.0",
      meta: { database_url: "postgresql://demo_user:s3cr3t@ep-example.neon.tech/expense_budget?sslmode=require" },
    });

    const response = errorResponse(err);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toContain("P2028");
    expect(body.error).toContain("請稍後再試");
    // The error code is fine to surface (it's a stable public Prisma
    // identifier), but the connection string / credentials in `meta` must
    // never reach the client.
    expect(JSON.stringify(body)).not.toContain("s3cr3t");
    expect(JSON.stringify(body)).not.toContain("neon.tech");
  });

  it("maps any other Prisma known-request error the same way, still without leaking meta", async () => {
    const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`code`)", {
      code: "P2002",
      clientVersion: "5.20.0",
      meta: { target: ["code"] },
    });

    const response = errorResponse(err);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toContain("P2002");
  });
});
