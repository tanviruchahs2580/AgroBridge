import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      auth?: { userId: string; role: string };
    }
  }
}

export function requestContext(req: Request, res: Response, next: NextFunction) {
  // Only echo caller-supplied ids that are visible-ASCII and short enough to
  // be a safe header value / log field; anything else gets a server-generated
  // id so a crafted header can neither throw on setHeader nor poison logs.
  const incoming = (req.headers["x-request-id"] as string) || "";
  req.requestId = /^[\x20-\x7e]{1,128}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader("X-Request-Id", req.requestId);

  // W3C trace-context correlation (ARC-14 partial): echo a valid `traceparent`'s
  // trace id back as `X-Trace-Id`. Hex-validated, so a vendor header cannot inject
  // characters into responses; `requestId` is untouched — the two identifiers
  // deliberately coexist (a request is one hop, a trace is the whole journey).
  const tpMatch = /^00-([0-9a-f]{32})-([0-9a-f]{16})-01$/.exec(
    ((req.headers["traceparent"] as string) || "").trim().toLowerCase()
  );
  if (tpMatch) {
    res.setHeader("X-Trace-Id", tpMatch[1]);
    (req as Request & { traceId?: string }).traceId = tpMatch[1];
  }
  next();
}

export function ok(res: Response, data: unknown, status = 200) {
  res.status(status).json({ ok: true, data, requestId: res.req.requestId });
}

export function fail(res: Response, status: number, code: string, message: string, details?: unknown, reference?: string) {
  res.status(status).json({ ok: false, error: { code, message, details, reference }, requestId: res.req.requestId });
}
