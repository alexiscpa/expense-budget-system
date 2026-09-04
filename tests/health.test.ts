import { describe, it, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { checkHealth } from "@/lib/health/check";
import { prisma } from "@/lib/prisma";

describe("health check", () => {
  it("reports ok when the database is reachable", async () => {
    const result = await checkHealth(prisma);
    expect(result.status).toBe("ok");
    expect(result.database).toBe("ok");
    expect(result.dbLatencyMs).not.toBeNull();
  });

  it("reports degraded/unreachable when the database connection fails (simulated Neon outage)", async () => {
    const brokenClient = new PrismaClient({
      datasources: { db: { url: "postgresql://invalid:invalid@127.0.0.1:1/does_not_exist?connect_timeout=1" } },
    });
    try {
      const result = await checkHealth(brokenClient);
      expect(result.status).toBe("degraded");
      expect(result.database).toBe("unreachable");
    } finally {
      await brokenClient.$disconnect();
    }
  }, 15000);

  it("never leaks a stack trace or raw error text in the health payload", async () => {
    const brokenClient = new PrismaClient({
      datasources: { db: { url: "postgresql://invalid:invalid@127.0.0.1:1/does_not_exist?connect_timeout=1" } },
    });
    try {
      const result = await checkHealth(brokenClient);
      const serialized = JSON.stringify(result);
      expect(serialized).not.toMatch(/at .*\.(ts|js):\d+/); // no stack frame lines
      expect(serialized).not.toContain("ECONNREFUSED");
    } finally {
      await brokenClient.$disconnect();
    }
  }, 15000);
});
