import type { Request, Response } from "express";
import { fail } from "./context.js";
import { logger } from "../shared/logging/logger.js";

/** Pull the human message out of express-rate-limit's `message` option. */
function messageFrom(options: unknown): string | null {
  const m = (options as { message?: unknown } | undefined)?.message;
  if (typeof m === "string") return m;
  if (m && typeof m === "object") {
    const err = (m as { error?: { message?: unknown } }).error;
    if (err && typeof err.message === "string") return err.message;
  }
  return null;
}

/**
 * 429 response used by every rate limiter.
 *
 * express-rate-limit's built-in serializer emits a bare object without the
 * API's request id, so a throttled caller could not be correlated to a log
 * line like every other error. Limiters run after `requestContext`, so
 * `res.req.requestId` is always populated here. The limiter's own `message`
 * option is preserved so each route keeps its specific copy; only the
 * envelope (requestId + standard error shape) is standardized.
 */
export function rateLimitHandler(req: Request, res: Response, _next: unknown, options?: unknown) {
  // Throttling was previously invisible in logs; a rate-limited caller must be
  // diagnosable like any other failure.
  logger.warn({ requestId: req.requestId, method: req.method, path: req.path }, "request rate limited");
  fail(res, 429, "RATE_LIMITED", messageFrom(options) ?? "Too many requests. Please slow down.");
}
