import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { ok } from "../../middleware/context.js";
import { forbidden, serviceUnavailable } from "../../shared/errors/index.js";
import { runRetention } from "../../shared/retention.js";
import { audit } from "../../middleware/audit.js";
import { logger } from "../../lib/logger.js";

/**
 * Scheduled-operations endpoints, invoked by the platform cron
 * (apps/api/vercel.json `crons`) — never by users. Vercel cron requests carry
 * `Authorization: Bearer $CRON_SECRET`; without the secret configured the
 * endpoints fail closed, because an unprotected retention trigger is a
 * data-deletion surface. Comparison is constant-time, like the webhook digest.
 */
export const opsRouter = Router();

opsRouter.get("/retention", async (req, res, next) => {
  try {
    const secret = env.CRON_SECRET;
    if (!secret) {
      throw serviceUnavailable("Scheduled retention is disabled: CRON_SECRET is not configured");
    }
    const provided = Buffer.from(req.headers.authorization ?? "", "utf8");
    const expected = Buffer.from(`Bearer ${secret}`, "utf8");
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
      throw forbidden("Scheduled operations require the cron secret");
    }

    const result = await runRetention(prisma, { log: (m) => logger.info(m) });
    logger.info({ result }, "ops: scheduled retention run complete");
    await audit({ action: "RETENTION_JOB_RUN", entityType: "System", entityId: "retention", meta: { ...result } });
    ok(res, { ran: true, ...result });
  } catch (e) {
    next(e);
  }
});
