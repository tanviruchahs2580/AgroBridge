import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  /**
   * Public base URL of THIS API (no trailing /api/v1). Needed so a payment
   * gateway can post the buyer back to us; derived from the request when unset.
   */
  API_PUBLIC_URL: z.string().url().optional(),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().positive().default(15),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  TRUST_PROXY: z.union([z.coerce.number().int().min(0), z.literal("false")]).default(1),
  METRICS_TOKEN: z.string().optional(), // when set, /metrics requires Authorization: Bearer <token> in production
  REDIS_URL: z.string().optional(), // when set, rate limiting uses Redis (multi-instance safe)
  WEATHER_PROVIDER: z.enum(["mock", "openweather"]).default("mock"),
  OPENWEATHER_API_KEY: z.string().optional(),
  AI_PROVIDER: z.enum(["offline", "openai-compatible"]).default("offline"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  AI_MONTHLY_BUDGET_PAISA: z.coerce.number().int().positive().default(500_00), // soft spend cap (৳500 default)
  AI_COST_PER_1K_TOKENS_PAISA: z.coerce.number().nonnegative().default(0),
  PAYMENT_PROVIDER: z.enum(["sandbox", "sslcommerz"]).default("sandbox"),
  SSLCOMMERZ_STORE_ID: z.string().optional(),
  SSLCOMMERZ_STORE_PASSWORD: z.string().optional(),
  SSLCOMMERZ_SANDBOX: z.string().optional(),
  /**
   * Explicit, auditable opt-in for simulated payments on a production
   * deployment (pilots/demos only). Without it, a production deployment with
   * the sandbox provider refuses to fabricate a successful payment — see
   * modules/payments/routes.ts.
   */
  ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION: z.enum(["0", "1"]).optional(),
  SMS_PROVIDER: z.enum(["sandbox", "none"]).default("sandbox"),
  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(), // for R2/MinIO-compatible stores
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
  throw new Error(`Invalid environment configuration -> ${issues}`);
}

// Warn loudly if running with development defaults outside development.
if (parsed.data.NODE_ENV === "production") {
  const weak =
    parsed.data.JWT_ACCESS_SECRET.includes("change-me") ||
    parsed.data.JWT_REFRESH_SECRET.includes("change-me") ||
    parsed.data.JWT_ACCESS_SECRET.startsWith("dev-");
  if (weak) throw new Error("Refusing to start production with default JWT secrets");
  // Phase 4: fail-fast — placeholder providers (mock/sandbox/offline/none) abort production
  // startup unless the operator explicitly acknowledges them via ALLOW_PLACEHOLDER_PROVIDERS=1.
  // No silent degradation either way: without the flag the process refuses to boot; with it,
  // every placeholder is listed as a startup warning.
  const placeholders: string[] = [];
  if (parsed.data.SMS_PROVIDER === "none") placeholders.push("SMS_PROVIDER=none (OTP would be undelivered)");
  if (parsed.data.SMS_PROVIDER === "sandbox") placeholders.push("SMS_PROVIDER=sandbox (OTP codes are logged, not sent)");
  if (parsed.data.WEATHER_PROVIDER === "mock") placeholders.push("WEATHER_PROVIDER=mock (fixture weather data)");
  if (parsed.data.AI_PROVIDER === "offline") placeholders.push("AI_PROVIDER=offline (KB-only answers, no LLM)");
  if (parsed.data.PAYMENT_PROVIDER === "sandbox")
    placeholders.push("PAYMENT_PROVIDER=sandbox (no real money moves; payments stay simulated)");
  if (parsed.data.STORAGE_PROVIDER === "local")
    placeholders.push("STORAGE_PROVIDER=local (uploads live on the instance disk and are lost on redeploy)");
  if (placeholders.length) {
    if (process.env.ALLOW_PLACEHOLDER_PROVIDERS !== "1") {
      throw new Error(
        `Placeholder provider(s) in production: ${placeholders.join("; ")} — configure real providers or set ALLOW_PLACEHOLDER_PROVIDERS=1 to accept them explicitly`,
      );
    }
    console.warn(`[env] Placeholder provider(s) EXPLICITLY ACCEPTED via ALLOW_PLACEHOLDER_PROVIDERS=1: ${placeholders.join("; ")}`);
  }
  if (parsed.data.WEATHER_PROVIDER === "openweather" && !parsed.data.OPENWEATHER_API_KEY) {
    throw new Error("OPENWEATHER_API_KEY missing for WEATHER_PROVIDER=openweather in production — startup aborted");
  }
  if (parsed.data.AI_PROVIDER === "openai-compatible" && !parsed.data.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY missing for AI_PROVIDER=openai-compatible in production — startup aborted");
  }
  if (parsed.data.STORAGE_PROVIDER === "s3") {
    const missing = ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter(
      (k) => !parsed.data[k as keyof typeof parsed.data],
    );
    if (missing.length) throw new Error(`STORAGE_PROVIDER=s3 missing in production: ${missing.join(", ")} — startup aborted`);
  }
  if (parsed.data.PAYMENT_PROVIDER === "sslcommerz") {
    if (!parsed.data.SSLCOMMERZ_STORE_ID || !parsed.data.SSLCOMMERZ_STORE_PASSWORD) {
      throw new Error("SSLCOMMERZ_STORE_ID/PASSWORD missing for PAYMENT_PROVIDER=sslcommerz in production — startup aborted");
    }
  }
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";

/** Fallback used when WEB_ORIGIN is empty or unparseable. */
const LOCAL_WEB_ORIGIN = "http://localhost:5173";

/**
 * The single browser origin to send a redirect to.
 *
 * WEB_ORIGIN is an allow-list (comma-separated) because a deployment serves the
 * site *and* the Capacitor app, whose WebView origin is `https://localhost`.
 * CORS wants the whole list; a redirect needs exactly one entry — passing the
 * list straight into `new URL()` silently produced a malformed location such as
 * `https://site.example,https/orders`.
 */
export function primaryOriginOf(webOrigin: string): string {
  const first = webOrigin
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)[0];
  if (!first) return LOCAL_WEB_ORIGIN;
  try {
    return new URL(first).origin;
  } catch {
    return LOCAL_WEB_ORIGIN;
  }
}

export const primaryWebOrigin = primaryOriginOf(env.WEB_ORIGIN);
