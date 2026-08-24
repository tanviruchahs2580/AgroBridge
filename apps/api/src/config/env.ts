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
  WEATHER_PROVIDER: z.enum(["mock", "openweather"]).default("mock"),
  OPENWEATHER_API_KEY: z.string().optional(),
  AI_PROVIDER: z.enum(["offline", "openai-compatible"]).default("offline"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  OPENAI_MODEL: z.string().default("gpt-4o-mini"),
  PAYMENT_PROVIDER: z.enum(["sandbox", "sslcommerz"]).default("sandbox"),
  SMS_PROVIDER: z.enum(["sandbox", "none"]).default("sandbox"),
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
