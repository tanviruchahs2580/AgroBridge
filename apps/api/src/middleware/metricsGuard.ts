import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env, isProd } from "../config/env.js";
import { forbidden, serviceUnavailable } from "../shared/errors/index.js";

const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/,
  /^fc00:/i,
  /^fd/i,
];

/** Constant-time bearer comparison (same discipline as the webhook digest). */
function bearerMatches(header: string, token: string): boolean {
  const provided = Buffer.from(header, "utf8");
  const expected = Buffer.from(`Bearer ${token}`, "utf8");
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

/**
 * /metrics is infrastructure reconnaissance surface (route/status traffic,
 * payment and AI counters, process internals). Two regimes:
 *
 * - Production: the token is required on EVERY request. A private
 *   `remoteAddress` proves nothing here — on serverless platforms (Vercel,
 *   Lambda, most container front-ends) every request's socket address is the
 *   platform's internal load balancer, so a private-range allowance is an
 *   allow-everything rule. When METRICS_TOKEN is unset the guard fails
 *   closed for all callers: an unscrapeable metrics endpoint is an ops
 *   inconvenience, a public one is fleet reconnaissance.
 * - Non-production: open from private networks (local docker Prometheus) and
 *   via token from anywhere.
 */
export function metricsGuard(req: Request, _res: Response, next: NextFunction) {
  const token = env.METRICS_TOKEN;

  if (isProd) {
    if (!token) {
      return next(serviceUnavailable("Metrics endpoint is disabled: METRICS_TOKEN is not configured"));
    }
    const header = req.headers.authorization ?? "";
    if (bearerMatches(header, token)) return next();
    return next(forbidden("Metrics endpoint requires a valid metrics token"));
  }

  // Node reports IPv4 sockets as "::ffff:127.0.0.1" (IPv4-mapped IPv6) on
  // dual-stack hosts — normalize before matching, or every loopback test
  // connection looks public.
  const addr = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  if (PRIVATE_RANGES.some((re) => re.test(addr))) return next();

  if (token && bearerMatches(req.headers.authorization ?? "", token)) return next();
  return next(forbidden("Metrics endpoint requires a private network or metrics token"));
}
