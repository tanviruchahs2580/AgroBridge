import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
import { fail } from "./context.js";

/**
 * Bounded concurrency — the guard that turns collapse into degradation (F-05).
 *
 * Measured before this existed: at 10 000 concurrent sessions a single instance
 * queued without limit. It served 210 req/s while 44 % of requests waited longer
 * than 30 seconds, p95 reached 56 s, and it never recovered — every user was
 * made to wait minutes so that a few thousand of them could eventually be
 * served. A request that is going to be served in 60 seconds has negative value
 * to the person holding the phone; an immediate "busy, retry" is kinder and lets
 * the client's own retry/backoff policy do something useful.
 *
 * So: count what this instance is actually working on, and past a ceiling answer
 * `503` + `Retry-After` in microseconds instead of joining the queue.
 *
 * Scope and ordering:
 *  - mounted on `/api/` only, deliberately. `/health`, `/ready` and `/metrics`
 *    stay reachable while the instance is drowning — an on-call engineer must be
 *    able to see that it is drowning.
 *  - mounted BEFORE the rate limiter, so a shed request costs no rate-limit
 *    budget: the caller is being refused by capacity, not by policy, and must not
 *    also lose quota for it.
 *
 * `MAX_CONCURRENT_REQUESTS=0` disables the guard (the pre-fix behaviour).
 * The right value is a property of the instance, not a constant: it must be
 * tuned so the resulting worst-case wait (`limit / sustained-rps`) stays inside
 * the client's patience. See docs/operations.md.
 */

let inFlight = 0;
let shed = 0;

export function admissionControl(req: Request, res: Response, next: NextFunction) {
  const ceiling = env.MAX_CONCURRENT_REQUESTS;
  if (ceiling <= 0) return next();

  if (inFlight >= ceiling) {
    shed++;
    logger.warn(
      { requestId: req.requestId, method: req.method, path: req.path, inFlight, ceiling },
      "shedding request — instance at its concurrency ceiling",
    );
    // One second: long enough to break a tight retry loop, short enough that a
    // caller which honours it rejoins a recovered instance promptly.
    res.setHeader("Retry-After", "1");
    return fail(res, 503, "OVERLOADED", "The service is busy right now. Please retry in a moment.");
  }

  inFlight++;
  // `finish` covers a normal response, `close` covers an aborted one; the latch
  // keeps a request that does both from releasing two slots.
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    inFlight--;
  };
  res.on("finish", release);
  res.on("close", release);

  next();
}

/** Observability + test seam: how many requests this instance is holding right now. */
export function admissionStats() {
  return { inFlight, shed, ceiling: env.MAX_CONCURRENT_REQUESTS };
}

/** Test seam: specs must not inherit each other's in-flight count. */
export function resetAdmissionState() {
  inFlight = 0;
  shed = 0;
}
