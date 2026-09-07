import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (Neon pooled connection string)"),
  DIRECT_URL: z.string().min(1, "DIRECT_URL is required (Neon direct connection string)"),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_URL: z.string().url().optional(),
  // Vercel injects this automatically on every deployment: "production" for
  // the Production environment, "preview" for PR/branch Preview
  // deployments, "development" for `vercel dev`. Not set at all when running
  // outside Vercel (local dev, CI, this sandbox). Used only to gate the
  // test-only auth bypass below - never trust it for anything security
  // sensitive beyond that single purpose.
  VERCEL_ENV: z.enum(["production", "preview", "development"]).optional(),
  // Test-only "Demo 測試環境" no-login switch - see isAuthBypassEnabled()
  // below. Left as a raw optional string (not a boolean) so that any value
  // other than the exact string "true" - unset, "false", "1", a typo - is
  // treated as off.
  AUTH_DISABLED: z.string().optional(),
});

type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Lazily validated environment access. Throws with a clear, non-sensitive
 * message if a required variable is missing/invalid rather than letting the
 * app boot in a half-configured state.
 */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid environment configuration. Missing/invalid: ${missing}`);
  }
  cached = parsed.data;
  return cached;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Whether the test-only "Demo 測試環境" no-login bypass is active for this
 * request. This is the single choke point every other bypass check
 * (middleware, getCurrentUser, the /login screen, the top banner) calls
 * through, so the rule can never drift between call sites.
 *
 * Fail-closed, Preview-only by design:
 *  - Production is hard-blocked first and unconditionally: if
 *    VERCEL_ENV === "production", this always returns false, no matter what
 *    AUTH_DISABLED is set to. There is deliberately no second override flag
 *    that could ever re-enable bypass in Production - a mistakenly-set
 *    AUTH_DISABLED=true in the Production environment variables has no
 *    effect on its own.
 *  - Outside that hard block, bypass requires BOTH VERCEL_ENV === "preview"
 *    AND AUTH_DISABLED === "true" (exact string match; unset, "false", "1",
 *    a typo all count as off). Any other environment - including local dev
 *    and this sandbox, where VERCEL_ENV is not set at all - never bypasses.
 *
 * Reads process.env directly rather than the validated getEnv() so this is
 * safe to call from the Edge middleware runtime (getEnv() requires
 * DATABASE_URL/SESSION_SECRET etc. to be present and throws otherwise, which
 * middleware must not depend on just to decide whether to redirect).
 */
export function isAuthBypassEnabled(): boolean {
  if (process.env.VERCEL_ENV === "production") return false;
  if (process.env.AUTH_DISABLED !== "true") return false;
  return process.env.VERCEL_ENV === "preview";
}
