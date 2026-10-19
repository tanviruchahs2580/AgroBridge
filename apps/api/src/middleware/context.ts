import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { badRequest } from "../shared/errors/index.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      /** W3C trace id of this request (incoming traceparent or a fresh one). */
      traceId: string;
      auth?: { userId: string; role: string };
    }
  }
}

/**
 * Request-scoped correlation fields. The values a log line carries today are
 * passed at each call site (`requestId: req.requestId`); this store lets the
 * shared logger attach them everywhere (see shared/logging/logger.ts) without
 * touching every call site, and gives tests a helper to assert on.
 */
export interface RequestTraceFields {
  requestId: string;
  traceId: string;
}

const requestStore = new AsyncLocalStorage<RequestTraceFields>();

/** Correlation fields of the request being served, or `{}` outside a request. */
export function currentTraceFields(): Partial<RequestTraceFields> {
  const store = requestStore.getStore();
  return store ? { requestId: store.requestId, traceId: store.traceId } : {};
}

/**
 * W3C trace context (version 00): `00-<32 hex trace id>-<16 hex parent id>-<2 hex flags>`.
 * Only 00 is accepted here; a value that is not exactly this shape is treated
 * as absent (the spec's "restart the trace" behaviour) rather than partially
 * trusted. All-zero ids are invalid per the spec — they are the "unknown"
 * sentinel, not a correlation handle.
 */
const TRACEPARENT_RE = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export interface ParsedTraceparent {
  traceId: string;
  parentId: string;
  flags: string;
}

export function parseTraceparent(header: unknown): ParsedTraceparent | null {
  if (typeof header !== "string") return null;
  const match = TRACEPARENT_RE.exec(header.trim().toLowerCase());
  if (!match) return null;
  const [, traceId, parentId, flags] = match;
  if (traceId === "0".repeat(32) || parentId === "0".repeat(16)) return null;
  return { traceId, parentId, flags };
}

function randomHex(bytes: number): string {
  return randomUUID().replace(/-/g, "").slice(0, bytes * 2);
}

export function requestContext(req: Request, res: Response, next: NextFunction) {
  // Only echo caller-supplied ids that are visible-ASCII and short enough to
  // be a safe header value / log field; anything else gets a server-generated
  // id so a crafted header can neither throw on setHeader nor poison logs.
  const incoming = (req.headers["x-request-id"] as string) || "";
  req.requestId = /^[\x20-\x7e]{1,128}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader("X-Request-Id", req.requestId);

  // Trace context: adopt a well-formed incoming traceparent (the caller's
  // trace continues through this service), otherwise start a fresh trace.
  // The response echoes the context: the same traceparent when it was
  // adopted, or the generated one. The API runs no spans of its own, so
  // replacing the parent id with a fabricated server span would imply
  // instrumentation that does not exist.
  const parsed = parseTraceparent(req.headers["traceparent"]);
  req.traceId = parsed?.traceId ?? randomHex(16);
  res.setHeader("traceparent", parsed ? `00-${parsed.traceId}-${parsed.parentId}-${parsed.flags}` : `00-${req.traceId}-${randomHex(8)}-01`);

  requestStore.run({ requestId: req.requestId, traceId: req.traceId }, next);
}

/**
 * Client idempotency key from the `Idempotency-Key` header, when present.
 * Absent header → null. A PRESENT but malformed value is a 400, never
 * silently ignored: the client sent it expecting replay protection, and
 * dropping it would turn its retry into a duplicate-side-effect request.
 * 8..128 visible-ASCII characters; the bounds keep hostile clients from
 * stuffing unbounded keys into the uniqueness/meta columns.
 */
export function idempotencyKeyOf(req: Request): string | null {
  const header = req.headers["idempotency-key"];
  if (header === undefined) return null;
  const value = Array.isArray(header) ? header[0] ?? "" : header;
  if (!/^[\x20-\x7e]{8,128}$/.test(value)) {
    throw badRequest("Idempotency-Key must be 8-128 visible ASCII characters");
  }
  return value;
}

export function ok(res: Response, data: unknown, status = 200) {
  res.status(status).json({ ok: true, data, requestId: res.req.requestId });
}

export function fail(res: Response, status: number, code: string, message: string, details?: unknown, reference?: string) {
  res.status(status).json({ ok: false, error: { code, message, details, reference }, requestId: res.req.requestId });
}
