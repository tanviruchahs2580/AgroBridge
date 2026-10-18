import { pino } from "pino";

/**
 * Fields that must never reach the log stream (AUD-113 / I-02): credentials,
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
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  redact: LOG_REDACT_PATHS,
  base: { service: "agrobridge-api" },
});
