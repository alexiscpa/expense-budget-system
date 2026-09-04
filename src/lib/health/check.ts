import type { PrismaClient } from "@prisma/client";

export interface HealthResult {
  status: "ok" | "degraded";
  app: "ok";
  database: "ok" | "unreachable";
  dbLatencyMs: number | null;
  timestamp: string;
}

/**
 * Extracted from the route handler so the "Neon unreachable" branch can be
 * exercised directly in tests (e.g. by passing a client pointed at a
 * connection that will fail) without needing to actually take Neon down.
 */
export async function checkHealth(client: Pick<PrismaClient, "$queryRaw">): Promise<HealthResult> {
  let dbOk = false;
  let dbLatencyMs: number | null = null;

  try {
    const start = Date.now();
    await client.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - start;
    dbOk = true;
  } catch {
    dbOk = false;
  }

  return {
    status: dbOk ? "ok" : "degraded",
    app: "ok",
    database: dbOk ? "ok" : "unreachable",
    dbLatencyMs,
    timestamp: new Date().toISOString(),
  };
}
