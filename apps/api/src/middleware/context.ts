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
  req.requestId = (req.headers["x-request-id"] as string) || randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
}

export function ok(res: Response, data: unknown, status = 200) {
  res.status(status).json({ ok: true, data, requestId: res.req.requestId });
}

export function fail(res: Response, status: number, code: string, message: string, details?: unknown) {
  res.status(status).json({ ok: false, error: { code, message, details }, requestId: res.req.requestId });
}
