import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globals: true,
    // Local-only ephemeral test database (not a secret, never used outside
    // this sandbox) - see README.md "Running tests" for setup instructions.
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/expense_budget_test?schema=public",
      DIRECT_URL: "postgresql://postgres:postgres@localhost:5432/expense_budget_test?schema=public",
      SESSION_SECRET: "test-only-session-secret-not-for-production-use-32chars",
      NODE_ENV: "test",
    },
    testTimeout: 30000,
    hookTimeout: 30000,
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "server-only": path.resolve(__dirname, "./tests/helpers/server-only-stub.ts"),
    },
  },
});
