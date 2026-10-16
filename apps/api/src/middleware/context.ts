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
  next();
}

export function ok(res: Response, data: unknown, status = 200) {
  res.status(status).json({ ok: true, data, requestId: res.req.requestId });
}

export function fail(res: Response, status: number, code: string, message: string, details?: unknown, reference?: string) {
  res.status(status).json({ ok: false, error: { code, message, details, reference }, requestId: res.req.requestId });
}
