import type { PrismaClient } from "@prisma/client";

export interface HealthResult {
  status: "ok" | "degraded";
  app: "ok";
  database: "ok" | "unreachable";
  dbLatencyMs: number | null;
  timestamp: string;
  // Vercel injects this automatically for every deployment (build-time env,
  // not a secret - it is the public commit SHA already visible in the repo
  // and in the GitHub PR's own deployment status). Lets anyone confirm
  // which commit is actually live on a given URL without needing local git
  // access - see the PR body/report for why this matters after a fix
  // depends on a specific commit being deployed.
  deployedCommit: string | null;
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
    deployedCommit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  };
}
