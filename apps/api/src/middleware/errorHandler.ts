import type { NextFunction, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { AppError } from "../lib/errors.js";
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
    logger.info({ requestId: req.requestId, reference, code: err.code, status: err.status }, "app error");
    return fail(res, err.status, err.code, err.message, err.details, reference);
  }

  // Prisma known errors -> structured API errors (avoid leaking internals)
  const anyErr = err as { code?: string; message?: string };
  if (anyErr?.code === "P2002") {
    return fail(res, 409, "CONFLICT", "A record with these unique values already exists", undefined, reference);
  }
  if (anyErr?.code === "P2025") {
    return fail(res, 404, "NOT_FOUND", "Resource not found", undefined, reference);
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
    { requestId: req.requestId, reference, err: anyErr?.message, stack: anyErr instanceof Error ? anyErr.stack : undefined },
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
  fail(res, 404, "ROUTE_NOT_FOUND", `No route for ${req.method} ${req.path}`, undefined, referenceCode());
}
