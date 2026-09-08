import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: PrismaClient | undefined;
}

// Reuse a single PrismaClient across hot reloads / serverless invocations to
// avoid exhausting Neon's connection limit. In production on Vercel each
// function instance gets its own client, which is why DATABASE_URL must be
// the pooled (PgBouncer) connection string.
//
// "query" is emitted as an event (not printed to stdout) purely so tests can
// attach `prisma.$on("query", ...)` and assert on the actual number of SQL
// round trips a code path makes - see tests/demo-seed.test.ts's regression
// test guarding against the O(n) round-trip pattern that caused the P2028
// "Transaction already closed" failure in seedDemoMasterData. With no
// listener attached (the normal request path), this has no observable
// effect: nothing is written to stdout/logs beyond what "error"/"warn"
// already produce.
export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: [
      ...(process.env.NODE_ENV === "development" ? [{ level: "warn", emit: "stdout" } as const] : []),
      { level: "error", emit: "stdout" } as const,
      { level: "query", emit: "event" } as const,
    ],
  });

if (process.env.NODE_ENV !== "production") {
  global.__prisma = prisma;
}
