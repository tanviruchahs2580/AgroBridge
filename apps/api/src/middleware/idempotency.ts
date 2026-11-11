import type { NextFunction, Request, Response } from "express";
import { fail, assertIdempotencyKey } from "./context.js";

/**
 * Accepts a standard `Idempotency-Key` header (RFC-draft style) on money-mutating
 * routes (ARC-10). The API's idempotency contract has always been the
 * `clientRequestId` *body field*; this middleware maps the header onto that field
 * so a standard client library (or an offline queue replaying a request) can carry
 * the key without knowing the body shape.
 *
 * Rules, deliberately strict:
 *  - the body field wins when both are present (it is the existing contract);
 *  - the header bound is `assertIdempotencyKey`'s — ONE validator for this
 *    header across the codebase (F-74: this file and `context.ts` used to
 *    disagree, so a 101-128 character key was accepted on some money routes
 *    and refused on others). The bound matches the checkout key schema;
 *  - a malformed header is a 400, not silently ignored: a caller that sends a key
 *    means to be idempotent, and silently dropping it would replay side effects.
 */
export function acceptIdempotencyKeyHeader(req: Request, res: Response, next: NextFunction) {
  const header = req.headers["idempotency-key"];
  if (header === undefined) return next();

  const raw = Array.isArray(header) ? (header[0] ?? "") : header;
  let key: string;
  try {
    key = assertIdempotencyKey(raw);
  } catch {
    return fail(res, 400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be 8-100 printable ASCII characters");
  }

  const body = req.body as Record<string, unknown> | undefined;
  const bodyKey = body?.clientRequestId;
  if (typeof bodyKey === "string" && bodyKey.length > 0) {
    if (bodyKey !== key) {
      return fail(res, 400, "IDEMPOTENCY_KEY_MISMATCH", "Idempotency-Key header does not match the body's clientRequestId");
    }
    return next();
  }
  if (typeof body === "object" && body !== null) body.clientRequestId = key;
  else req.body = { clientRequestId: key };
  return next();
}
