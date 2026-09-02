import { env } from "../config/env.js";

export type HealthStatus = "HEALTHY" | "DEGRADED" | "DOWN" | "DISABLED";

export interface ProviderHealth {
  provider: string;
  status: HealthStatus;
  reason?: string;
  lastCheckedAt: string;
}

const health: Record<string, ProviderHealth> = {};

function set(provider: string, status: HealthStatus, reason?: string) {
  health[provider] = { provider, status, reason, lastCheckedAt: new Date().toISOString() };
}

export function getHealthRegistry(): Record<string, ProviderHealth> {
  return { ...health };
}

export function initHealthRegistry() {
  // AI
  if (env.AI_PROVIDER === "offline") {
    set("ai", env.NODE_ENV === "production" ? "DOWN" : "DEGRADED", "AI_PROVIDER=offline (mock)");
  } else if (env.AI_PROVIDER === "openai-compatible" && !env.OPENAI_API_KEY) {
    set("ai", "DOWN", "OPENAI_API_KEY missing");
  } else {
    set("ai", "HEALTHY");
  }
  // Weather
  if (env.WEATHER_PROVIDER === "mock") {
    set("weather", env.NODE_ENV === "production" ? "DOWN" : "DEGRADED", "WEATHER_PROVIDER=mock");
  } else if (env.WEATHER_PROVIDER === "openweather" && !env.OPENWEATHER_API_KEY) {
    set("weather", "DOWN", "OPENWEATHER_API_KEY missing");
  } else {
    set("weather", "HEALTHY");
  }
  // SMS
  if (env.SMS_PROVIDER === "none") set("sms", "DOWN", "SMS_PROVIDER=none (undelivered)");
  else if (env.SMS_PROVIDER === "sandbox") set("sms", env.NODE_ENV === "production" ? "DOWN" : "DEGRADED", "SMS_PROVIDER=sandbox");
  else set("sms", "HEALTHY");
  // Storage
  if (env.STORAGE_PROVIDER === "s3" && (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY)) {
    set("storage", "DOWN", "S3 credentials missing");
  } else {
    set("storage", "HEALTHY");
  }
  // Payment
  if (env.PAYMENT_PROVIDER === "sslcommerz" && (!env.SSLCOMMERZ_STORE_ID || !env.SSLCOMMERZ_STORE_PASSWORD)) {
    set("payment", "DOWN", "SSLCommerz credentials missing");
  } else {
    set("payment", "HEALTHY");
  }
}

export function markDegraded(provider: string, reason: string) {
  set(provider, "DEGRADED", reason);
}

export function markDown(provider: string, reason: string) {
  set(provider, "DOWN", reason);
}
