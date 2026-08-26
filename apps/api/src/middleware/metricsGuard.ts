import type { NextFunction, Request, Response } from "express";
import { env, isProd } from "../config/env.js";
import { forbidden } from "../lib/errors.js";

const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/,
  /^fc00:/i,
  /^fd/i,
];

/**
 * /metrics is infrastructure reconnaissance surface. Open on loopback/private
 * networks and in non-production; in production require either a private
 * source address or a valid METRICS_TOKEN bearer.
 */
export function metricsGuard(req: Request, _res: Response, next: NextFunction) {
  if (!isProd) return next();

  const addr = req.socket.remoteAddress ?? "";
  if (PRIVATE_RANGES.some((re) => re.test(addr))) return next();

  const token = env.METRICS_TOKEN;
  if (token) {
    const header = req.headers.authorization ?? "";
    if (header === `Bearer ${token}`) return next();
  }
  return next(forbidden("Metrics endpoint requires a private network or metrics token"));
}
