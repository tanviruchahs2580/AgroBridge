import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";

/**
 * First-party product analytics. Lightweight, privacy-respecting (no PII in
 * props), self-hosted — feeds the activation/funnel KPIs defined in the
 * Phase 1 product audit without shipping user data to third parties.
 */
export const analyticsRouter = Router();

const eventSchema = z.object({
  events: z
    .array(
      z.object({
        name: z.string().regex(/^[a-z_]{3,64}$/),
        sessionId: z.string().max(64).optional(),
        props: z.record(z.union([z.string().max(120), z.number(), z.boolean()])).optional(),
      })
    )
    .min(1)
    .max(20),
});

analyticsRouter.post("/events", requireAuth, validate({ body: eventSchema }), async (req, res, next) => {
  try {
    const { events } = req.body as z.infer<typeof eventSchema>;
    // Fire-and-forget ingest: never block the caller on analytics.
    void prisma.analyticsEvent
      .createMany({
        data: events.map((e) => ({
          name: e.name,
          userId: req.auth!.userId,
          sessionId: e.sessionId,
          propsStr: e.props ? JSON.stringify(e.props) : undefined,
        })),
      })
      .catch(() => undefined);
    res.status(202).json({ ok: true, data: { accepted: events.length }, requestId: req.requestId });
  } catch (e) {
    next(e);
  }
});
