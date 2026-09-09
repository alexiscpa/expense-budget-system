import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (Neon pooled connection string)"),
  DIRECT_URL: z.string().min(1, "DIRECT_URL is required (Neon direct connection string)"),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must be at least 32 characters"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_BASE_URL: z.string().url().optional(),
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
 * True only on a Vercel Preview deployment that has been explicitly
 * provisioned for open QA testing (AUTH_DISABLED=true set alongside it).
 * Both flags are read directly from process.env (not the strict envSchema
 * above) because they are optional and absent in every other environment,
 * including production - this must default to false, never throw, so a
 * misconfigured/missing flag can never accidentally enable preview-only
 * behavior. Gates test-data endpoints such as POST /api/demo/stress-seed;
 * never use it to bypass authentication or RBAC checks themselves.
 */
export function isPreviewStressSeedEnvironment(): boolean {
  return process.env.VERCEL_ENV === "preview" && process.env.AUTH_DISABLED === "true";
}
