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
  /**
   * Prisma pool size for this instance (F-06). Unset keeps Prisma's default
   * (`cpus * 2 + 1`), which was 9 connections on the audited box — the fleet's
   * total must stay inside the database's own `max_connections`, so the right
   * value depends on how many instances run, not on a constant. Applied to
   * PostgreSQL URLs only; the SQLite dev/test profile is untouched.
   */
  DATABASE_CONNECTION_LIMIT: z.coerce.number().int().positive().optional(),
  /**
   * Seconds a request may wait for a free pool connection before failing
   * (Prisma default: 10). On expiry the API answers 503 + Retry-After rather
   * than a bare 500 (see errorHandler's P2024 mapping).
   */
  DATABASE_POOL_TIMEOUT_SECONDS: z.coerce.number().int().positive().optional(),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  ACCESS_TOKEN_TTL: z.string().default("15m"),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().positive().default(15),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  /**
   * Login attempts per window per ACCOUNT (F-04 from the 10k audit). Keyed by the
   * account an attempt names, not by address, so one neighbour behind a carrier
   * NAT cannot spend a user's budget — see middleware/rateLimitKeys.ts. CI's e2e
   * job raises it for its throwaway instance because a browser suite signs in far
   * more often than a person (observed 2026-10-17).
   */
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  /**
   * Account creations per window per ADDRESS. Deliberately still address-keyed:
   * this is the mass-registration control and the key would otherwise be
   * attacker-supplied. Raise it on deployments that legitimately serve a large
   * shared address (a village kiosk or a campus NAT).
   */
  REGISTER_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  /**
   * Worker threads used for bcrypt hashing (F-02). Unset selects
   * `min(4, cores - 1)`. `0` disables the pool and hashes on the event loop —
   * the pre-fix behaviour, kept as an operational escape hatch.
   */
  BCRYPT_POOL_SIZE: z.coerce.number().int().min(0).max(16).optional(),
  /**
   * Largest number of requests this instance will work on at once. Beyond it the
   * API answers 503 + Retry-After instead of queueing without bound (F-05).
   *
   * Measured on the audited box (one instance, ~150 req/s sustainable for a
   * mixed authenticated read load), under a deliberately unbounded 1 000-user
   * burst of the same query mix:
   *
   *   ceiling 256  → 11 438 req served, 143 req/s, p50 1 142 ms, 14.6 % over 30 s, 0 shed
   *   ceiling  24  → 27 267 req handled, 341 req/s, p50   385 ms,  6.1 % over 30 s, 21 807 shed
   *   guard off    → 12 203 req served, 153 req/s, p50   954 ms, 13.1 % over 30 s
   *
   * Too high a ceiling protects nothing: the excess waits in the socket accept
   * backlog, where no middleware runs, so it is neither admitted nor refused and
   * the caller still waits ~50 s. Sized near what the instance actually sustains,
   * the guard turns that wait into an immediate retryable refusal — three times
   * better p50 and 2.4x fewer timeouts, while serving more requests overall.
   * Tune it to the instance; see docs/operations.md. `0` disables the guard.
   */
  MAX_CONCURRENT_REQUESTS: z.coerce.number().int().nonnegative().default(128),
  /**
   * Socket-level timeouts, in milliseconds (F-09). Node's defaults are 300 s for
   * a whole request and 60 s for headers, so a stalled or queued request could be
   * held for minutes — longer than any client waits. Both are shortened to fail
   * before the web client's own 45 s timeout expires.
   */
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  HEADERS_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  /**
   * Idle keep-alive socket lifetime. Unset keeps Node's 5 s default, which is the
   * safe ordering in front of a typical 60 s load-balancer idle timeout: the
   * server closes an idle connection before the balancer tries to reuse it. Only
   * set this when the balancer in front closes idle connections first, and then
   * set it above that idle timeout — and raise HEADERS_TIMEOUT_MS above this value
   * too, or a connection can be closed while its next request's headers are still
   * arriving.
   */
  KEEPALIVE_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
  /**
   * Cap on simultaneous open connections to this instance. Unset keeps Node's no
   * limit. The one measured fact that makes this worth having: at 10 000
   * concurrent sessions the in-process admission guard capped the requests it
   * *handled* (256) while excess demand piled up in the socket accept backlog
   * invisible to it, so callers still waited ~50 s. Refusing the connection at the
   * edge — a faster failure than any application-level response — is what a proxy
   * or load balancer is there to do, and this is that knob inside the process.
   * Set it well above legitimate concurrency, next to whatever sits in front.
   */
  SERVER_MAX_CONNECTIONS: z.coerce.number().int().positive().optional(),
  TRUST_PROXY: z.union([z.coerce.number().int().min(0), z.literal("false")]).default(1),
  METRICS_TOKEN: z.string().optional(), // when set, /metrics requires Authorization: Bearer <token> in production
  /** When set, Vercel cron jobs send it as `Authorization: Bearer <token>`; the ops endpoints fail closed without it. */
  CRON_SECRET: z.string().optional(),
  /** pino level (debug|info|warn|error|silent); unset = info, silent in tests. */
  LOG_LEVEL: z.string().optional(),
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
  /**
   * Advisory requests per hour PER USER (F-03). The quota is now charged to the
   * account rather than to the caller's address, so the fleet-wide ceiling is
   * (active users x this) — the monthly budget breaker above guards spend, and
   * this is the per-user fairness knob.
   */
  AI_HOURLY_LIMIT: z.coerce.number().int().positive().default(30),
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
  /** Base directory for STORAGE_PROVIDER=local uploads; default <api cwd>/uploads. */
  UPLOAD_BASE_DIR: z.string().optional(),
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
export const isDev = env.NODE_ENV === "development";

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
