import { pino } from "pino";
import { env, isTest } from "../../config/env.js";
import { currentTraceFields } from "../../middleware/context.js";

/**
 * Fields that must never reach the log stream: credentials,
 * headers, and — defence-in-depth beyond what any call site logs today —
 * farmer PII (phone) and location (lat/lng/latitude/longitude). `refreshToken`
 * was previously missed by the generic `*.token` pattern, and phone/coords had
 * no pattern at all, so a future log call could leak them unnoticed.
 */
export const LOG_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "*.password",
  "*.passwordHash",
  "*.token",
  "*.refreshToken",
  "*.phone",
  "*.phoneNumber",
  "*.lat",
  "*.lng",
  "*.latitude",
  "*.longitude",
  "password",
  "passwordHash",
  "token",
  "refreshToken",
  "phone",
  "phoneNumber",
  "lat",
  "lng",
  "latitude",
  "longitude",
  "secretKey",
  "accessKey",
  "S3_SECRET_ACCESS_KEY",
];

export const logger = pino({
  // Reads through config/env.ts so LOG_LEVEL is validated in one place; the
  // default keeps test output quiet unless a test opts into a level.
  level: env.LOG_LEVEL ?? (isTest ? "silent" : "info"),
  redact: LOG_REDACT_PATHS,
  base: { service: "agrobridge-api" },
  // Every line emitted while a request is in flight carries its requestId and
  // W3C traceId without each call site re-passing them (middleware/context.ts
  // keeps the per-request store).
  mixin: currentTraceFields,
});
