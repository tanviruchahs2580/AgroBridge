import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
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
  // Phase 4: fail-fast — mock/none providers are forbidden in production (no silent degradation).
  if (parsed.data.SMS_PROVIDER === "none") {
    throw new Error("SMS_PROVIDER configured as none in production — startup aborted (OTP would be undelivered)");
  }
  if (parsed.data.SMS_PROVIDER === "sandbox") {
    throw new Error("SMS_PROVIDER sandbox forbidden in production — configure real SMS provider");
  }
  if (parsed.data.WEATHER_PROVIDER === "mock") {
    throw new Error("WEATHER_PROVIDER mock forbidden in production — configure openweather with OPENWEATHER_API_KEY");
  }
  if (parsed.data.WEATHER_PROVIDER === "openweather" && !parsed.data.OPENWEATHER_API_KEY) {
    throw new Error("OPENWEATHER_API_KEY missing for WEATHER_PROVIDER=openweather in production — startup aborted");
  }
  if (parsed.data.AI_PROVIDER === "offline") {
    throw new Error("AI_PROVIDER offline forbidden in production — configure openai-compatible with OPENAI_API_KEY");
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
