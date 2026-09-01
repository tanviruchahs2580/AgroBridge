import { pino } from "pino";

const redactPaths = ["req.headers.authorization", "req.headers.cookie", "*.password", "*.passwordHash", "*.token", "password", "passwordHash", "token", "secretKey", "accessKey", "S3_SECRET_ACCESS_KEY"];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "test" ? "silent" : "info"),
  redact: redactPaths,
  base: { service: "agrobridge-api" },
});
