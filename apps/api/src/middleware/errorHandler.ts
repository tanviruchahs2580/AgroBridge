import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { isProd } from "../config/env.js";
import { fail } from "./context.js";

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return fail(res, err.status, err.code, err.message, err.details);
  }

  // Prisma known errors -> structured API errors (avoid leaking internals)
  const anyErr = err as { code?: string; message?: string };
  if (anyErr?.code === "P2002") {
    return fail(res, 409, "CONFLICT", "A record with these unique values already exists");
  }
  if (anyErr?.code === "P2025") {
    return fail(res, 404, "NOT_FOUND", "Resource not found");
  }

  // JSON body parse/limit errors
  const errType = (err as { type?: string })?.type;
  if (errType === "entity.parse.failed") {
    return fail(res, 400, "INVALID_JSON", "Request body is not valid JSON");
  }
  if (errType === "entity.too.large") {
    return fail(res, 413, "PAYLOAD_TOO_LARGE", "Request payload exceeds the allowed limit");
  }

  logger.error({ requestId: req.requestId, err: anyErr?.message, stack: anyErr instanceof Error ? anyErr.stack : undefined }, "unhandled error");

  // Farmer-friendly generic error; technical detail only in non-production responses.
  return fail(
    res,
    500,
    "INTERNAL_ERROR",
    isProd ? "Service temporarily unavailable. Please try again shortly." : (anyErr?.message ?? "Internal server error")
  );
}

export function notFoundHandler(req: Request, res: Response) {
  fail(res, 404, "ROUTE_NOT_FOUND", `No route for ${req.method} ${req.path}`);
}
