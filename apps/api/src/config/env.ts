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
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
