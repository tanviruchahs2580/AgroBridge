import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  /**
   * Production escape hatch that re-admits http://localhost origins into the
   * CORS allow-list. Only the local docker stack needs it (NODE_ENV=production
   * there, but the web UI is served from http://localhost:8080). Never set it
   * on a real deployment — a live allow-list containing a dev origin lets any
   * locally-served page make cross-origin calls to this API.
   */
  ALLOW_DEV_ORIGINS: z.enum(["0", "1"]).optional(),
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
  /**
   * Login attempts per window per IP. The default is the production policy; CI's
   * e2e job raises it for its throwaway instance because a browser suite signs in
   * far more often than a person, and exhausting the limit makes unrelated
   * assertions fail (observed 2026-10-17).
   */
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  TRUST_PROXY: z.union([z.coerce.number().int().min(0), z.literal("false")]).default(1),
  METRICS_TOKEN: z.string().optional(), // when set, /metrics requires Authorization: Bearer <token> in production
  REDIS_URL: z.string().optional(), // when set, rate limiting uses Redis (multi-instance safe)
  WEATHER_PROVIDER: z.enum(["mock", "openweather"]).default("mock"),
  OPENWEATHER_API_KEY: z.string().optional(),
  /**
   * How long a successful weather fetch is reused, keyed by rounded location
   *. 0 disables caching. Provider failures are never served from
   * cache as "current" — a failure is an honest error, not stale data.
   */
  WEATHER_CACHE_TTL_SECONDS: z.coerce.number().int().nonnegative().default(600),
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
  SMS_PROVIDER: z.enum(["sandbox", "none", "http"]).default("sandbox"),
  /**
   * Generic HTTP SMS gateway (SMS_PROVIDER=http): a POST endpoint that
   * receives `{ to, text }` with an optional bearer token and sender id.
   * Keeping it provider-agnostic means activating real OTP delivery is an
   * operator env change, not a code change (OD-15).
   */
  SMS_API_URL: z.string().url().optional(),
  SMS_API_KEY: z.string().optional(),
  SMS_SENDER_ID: z.string().optional(),
  STORAGE_PROVIDER: z.enum(["local", "s3", "db"]).default("local"),
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

/**
 * Every placeholder / opt-in that is currently accepted, in operator-facing words.
 *
 * Extracted from the production guard so it can be unit-tested and reused: the
 * startup warning must list *everything* simulated on this deployment, including
 * the explicit sandbox-payments opt-in — a money-path flag that would otherwise
 * only be discoverable by reading the environment.
 */
export function placeholderManifest(cfg: {
  SMS_PROVIDER?: string;
  WEATHER_PROVIDER?: string;
  AI_PROVIDER?: string;
  PAYMENT_PROVIDER?: string;
  STORAGE_PROVIDER?: string;
  ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION?: string;
}): string[] {
  const placeholders: string[] = [];
  if (cfg.SMS_PROVIDER === "none") placeholders.push("SMS_PROVIDER=none (OTP would be undelivered)");
  if (cfg.SMS_PROVIDER === "sandbox") placeholders.push("SMS_PROVIDER=sandbox (OTP codes are logged, not sent)");
  if (cfg.WEATHER_PROVIDER === "mock") placeholders.push("WEATHER_PROVIDER=mock (fixture weather data)");
  if (cfg.AI_PROVIDER === "offline") placeholders.push("AI_PROVIDER=offline (KB-only answers, no LLM)");
  if (cfg.PAYMENT_PROVIDER === "sandbox")
    placeholders.push("PAYMENT_PROVIDER=sandbox (no real money moves; payments stay simulated)");
  if (cfg.ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION === "1")
    placeholders.push(
      "ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION=1 (buyers can COMPLETE simulated payments on this deployment — demo/pilot only, must be removed before store submission)",
    );
  if (cfg.STORAGE_PROVIDER === "local")
    placeholders.push(
      "STORAGE_PROVIDER=local (uploads live on the instance disk and are lost on redeploy — use db for durable uploads, or s3)",
    );
  return placeholders;
}

/**
 * The monthly AI spend breaker multiplies usage by
 * AI_COST_PER_1K_TOKENS_PAISA; with the default 0 it can never trip, so a
 * hosted provider in production would run unbounded. Fail closed
 * rather than shipping an inert money guard. Returns the error text or null.
 * Extracted for unit testing, like placeholderManifest.
 */
export function hostedAiCostProblem(cfg: { AI_PROVIDER?: string; AI_COST_PER_1K_TOKENS_PAISA?: number }): string | null {
  if (cfg.AI_PROVIDER !== "openai-compatible") return null;
  if ((cfg.AI_COST_PER_1K_TOKENS_PAISA ?? 0) > 0) return null;
  return "AI_COST_PER_1K_TOKENS_PAISA must be > 0 with AI_PROVIDER=openai-compatible in production — the monthly spend breaker cannot trip otherwise (set the provider's real per-1K-token price in paisa)";
}

// Warn loudly if running with development defaults outside development.
if (parsed.data.NODE_ENV === "production") {
  const weak =
    parsed.data.JWT_ACCESS_SECRET.includes("change-me") ||
    parsed.data.JWT_REFRESH_SECRET.includes("change-me") ||
    parsed.data.JWT_ACCESS_SECRET.startsWith("dev-");
  if (weak) throw new Error("Refusing to start production with default JWT secrets");
  //fail-fast — placeholder providers (mock/sandbox/offline/none) abort production
  // startup unless the operator explicitly acknowledges them via ALLOW_PLACEHOLDER_PROVIDERS=1.
  // No silent degradation either way: without the flag the process refuses to boot; with it,
  // every placeholder is listed as a startup warning.
  const placeholders = placeholderManifest(parsed.data);
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
  if (parsed.data.SMS_PROVIDER === "http" && (!parsed.data.SMS_API_URL || !parsed.data.SMS_API_KEY)) {
    throw new Error("SMS_API_URL/SMS_API_KEY missing for SMS_PROVIDER=http in production — startup aborted");
  }
  const aiCostProblem = hostedAiCostProblem(parsed.data);
  if (aiCostProblem) throw new Error(`${aiCostProblem} — startup aborted`);
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
 * list straight into `new URL` silently produced a malformed location such as
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

/**
 * Browser origins allowed to call this API.
 *
 * In production, plain-HTTP localhost origins are dropped from the allow-list:
 * they are developer origins, and the live list once still contained
 * `http://localhost:5173`, letting any locally-served page make cross-origin
 * requests to the production API. `https://localhost` is deliberately KEPT —
 * that is the Capacitor WebView origin the Android build uses. The docker
 * development stack opts back in via ALLOW_DEV_ORIGINS=1.
 */
export function corsOrigins(webOrigin: string, opts: { prod: boolean; allowDevOrigins?: boolean }): string[] {
  const list = webOrigin.split(",").map((s) => s.trim()).filter(Boolean);
  if (!opts.prod || opts.allowDevOrigins) return list;
  return list.filter((origin) => {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      return false; // unparseable entries cannot be matched safely — drop them
    }
    const localHostname = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    return !(url.protocol === "http:" && localHostname);
  });
}

export const corsAllowedOrigins = corsOrigins(env.WEB_ORIGIN, {
  prod: isProd,
  allowDevOrigins: env.ALLOW_DEV_ORIGINS === "1",
});
