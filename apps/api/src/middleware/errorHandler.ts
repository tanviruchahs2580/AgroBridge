import type { NextFunction, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { AppError } from "../shared/errors/index.js";
import { logger } from "../lib/logger.js";
import { isProd } from "../config/env.js";
import { fail } from "./context.js";

/**
 * Stable human-referenceable support code (AB-XXXXX) attached to every error
 * response so a farmer can quote it and support can correlate the exact log line.
 */
function referenceCode(): string {
  return `AB-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const reference = referenceCode();

  if (err instanceof AppError) {
    logger.info({ requestId: req.requestId, method: req.method, path: req.path, reference, code: err.code, status: err.status }, "app error");
    return fail(res, err.status, err.code, err.message, err.details, reference);
  }

  // Prisma known errors -> structured API errors (avoid leaking internals)
  const anyErr = err as { code?: string; message?: string };
  if (anyErr?.code === "P2002") {
    logger.warn({ requestId: req.requestId, method: req.method, path: req.path, reference }, "prisma P2002 conflict");
    return fail(res, 409, "CONFLICT", "A record with these unique values already exists", undefined, reference);
  }
  if (anyErr?.code === "P2025") {
    return fail(res, 404, "NOT_FOUND", "Resource not found", undefined, reference);
  }
  // Foreign-key restriction: the row is referenced by other records that must
  // not be cascaded (e.g. a farm with bookings or purchase orders). Without
  // this mapping the conflict surfaced as a raw 500.
  if (anyErr?.code === "P2003") {
    logger.warn({ requestId: req.requestId, method: req.method, path: req.path, reference }, "prisma P2003 foreign key restriction");
    return fail(
      res,
      409,
      "DEPENDENT_RECORDS",
      "This record is still referenced by other data and cannot be removed yet",
      undefined,
      reference
    );
  }

  // Pool exhaustion. Prisma stops waiting for a free connection after
  // `pool_timeout` and raises P2024; that is a capacity condition, not a defect
  // in the request. It must be an honest, retryable 503 rather than a bare 500
  // that reads as "the server is broken" (F-06). Retry-After is short because a
  // pool frees up as soon as the in-flight queries drain.
  if (anyErr?.code === "P2024") {
    logger.warn({ requestId: req.requestId, method: req.method, path: req.path, reference }, "prisma pool timeout — shedding");
    res.setHeader("Retry-After", "2");
    return fail(
      res,
      503,
      "DB_POOL_EXHAUSTED",
      "The service is busy right now. Please retry in a moment.",
      undefined,
      reference
    );
  }

  // JSON body parse/limit errors
  const errType = (err as { type?: string })?.type;
  if (errType === "entity.parse.failed") {
    return fail(res, 400, "INVALID_JSON", "Request body is not valid JSON", undefined, reference);
  }
  if (errType === "entity.too.large") {
    return fail(res, 413, "PAYLOAD_TOO_LARGE", "Request payload exceeds the allowed limit", undefined, reference);
  }

  logger.error(
    { requestId: req.requestId, method: req.method, path: req.path, reference, err: anyErr?.message, stack: anyErr instanceof Error ? anyErr.stack : undefined },
    "unhandled error"
  );

  // Farmer-friendly generic error; technical detail only in non-production responses.
  return fail(
    res,
    500,
    "INTERNAL_ERROR",
    isProd ? "Service temporarily unavailable. Please try again shortly." : (anyErr?.message ?? "Internal server error"),
    undefined,
    reference
  );
}

export function notFoundHandler(req: Request, res: Response) {
  const reference = referenceCode();
  logger.warn({ requestId: req.requestId, method: req.method, path: req.path, reference }, "route not found");
  fail(res, 404, "ROUTE_NOT_FOUND", `No route for ${req.method} ${req.path}`, undefined, reference);
}
