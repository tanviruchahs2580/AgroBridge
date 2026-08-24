import type { NextFunction, Request, Response } from "express";
import { prisma } from "../lib/prisma.js";
import { logger } from "../lib/logger.js";

/** Append-only audit trail for security/business-relevant actions. Never blocks the response on failure. */
export async function audit(params: {
  actorId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  ip?: string;
  meta?: Record<string, unknown>;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: params.actorId ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        ip: params.ip,
        metaStr: params.meta ? JSON.stringify(params.meta) : undefined,
      },
    });
  } catch (e) {
    logger.warn({ action: params.action, err: (e as Error).message }, "audit write failed");
  }
}

export function auditMiddleware(action: string, getEntity?: (req: Request) => { entityType?: string; entityId?: string }) {
  return (req: Request, _res: Response, next: NextFunction) => {
    audit({
      actorId: req.auth?.userId,
      action,
      ip: req.ip,
      ...(getEntity ? getEntity(req) : {}),
    })
      .catch(() => undefined)
      .finally(() => next());
  };
}
