import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { askAgroAgent } from "../../providers/ai/gateway.js";
import { KNOWLEDGE_BASE } from "../../providers/ai/knowledge.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ok } from "../../middleware/context.js";
import { env } from "../../config/env.js";
import { createRedisStore } from "../../lib/rateLimitRedis.js";
import { rateLimitHandler } from "../../middleware/rateLimitResponse.js";
import { audit } from "../../middleware/audit.js";
import { notFound } from "../../shared/errors/index.js";

export const aiRouter = Router();
aiRouter.use(requireAuth);

// AI endpoints are expensive -> stricter limit than global. The custom handler
// keeps this limiter's message but wraps it in the standard error envelope with
// the request id, so a throttled caller is still correlatable.
const aiStore = env.REDIS_URL ? createRedisStore(env.REDIS_URL, 60 * 60 * 1000) : undefined;
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: aiStore,
  handler: rateLimitHandler,
  message: { ok: false, error: { code: "RATE_LIMITED", message: "AI advisory limit reached for this hour. Please try later." } },
});

aiRouter.post(
  "/advisory",
  aiLimiter,
  validate({
    body: z.object({
      question: z.string().trim().min(5).max(1000),
      lang: z.enum(["bn", "en"]).default("bn"),
      cropName: z.string().trim().max(80).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { question, lang, cropName } = req.body as { question: string; lang: "bn" | "en"; cropName?: string };

      // Context extraction: farmer + active crop context for grounding.
      const user = await prisma.user.findUnique({
        where: { id: req.auth!.userId },
        select: {
          fullName: true,
          langPref: true,
          farmerProfile: { select: { membershipTier: true, district: true } },
          farms: {
            take: 1,
            orderBy: { createdAt: "desc" },
            select: {
              district: true, lat: true, lng: true,
              plots: { take: 1, select: { cropCycles: { where: { status: "ACTIVE" }, take: 1, select: { cropName: true, stage: true } } } },
            },
          },
        },
      });

      const farm = user?.farms?.[0];
      const activeCrop = farm?.plots?.[0]?.cropCycles?.[0];

      const answer = await askAgroAgent(question, {
        userId: req.auth!.userId,
        requestId: req.requestId,
        lang,
        farmerName: user?.fullName,
        cropName: cropName ?? activeCrop?.cropName,
        cropStage: activeCrop?.stage,
        district: user?.farmerProfile?.district ?? farm?.district ?? undefined,
        membershipTier: user?.farmerProfile?.membershipTier,
      });

      ok(res, answer);
    } catch (e) {
      next(e);
    }
  }
);

/**
 * Stored `groundedRefs` may point at KB entries removed after the answer was
 * persisted. Resolve them against the current KB at read
 * time and return only refs that still exist, preserving stored order. The
 * field is additive, so existing clients keep working; a removed entry simply
 * disappears from a history row instead of being served as a live citation.
 */
export function liveGroundedRefs(stored: string | null): string[] {
  if (!stored) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const live = new Set(KNOWLEDGE_BASE.map((e) => e.id));
  const out: string[] = [];
  for (const ref of parsed) {
    if (typeof ref === "string" && live.has(ref) && !out.includes(ref)) out.push(ref);
  }
  return out;
}

aiRouter.get("/history", async (req, res, next) => {
  try {
    const rows = await prisma.advisoryQuery.findMany({
      where: { userId: req.auth!.userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        question: true,
        answer: true,
        confidence: true,
        lowConfidenceFlag: true,
        groundedRefs: true,
        feedbackReason: true,
        feedbackAt: true,
        createdAt: true,
        // Provenance of the stored answer (added 2026-10-19): which KB corpus
        // and prompt template produced it, and the request that carried it.
        // Older rows predate the columns and are null.
        kbVersion: true,
        promptVersion: true,
        requestId: true,
      },
    });
    const history = rows.map(({ groundedRefs, ...row }) => ({ ...row, groundedRefs: liveGroundedRefs(groundedRefs) }));
    ok(res, history);
  } catch (e) {
    next(e);
  }
});

/**
 * Advisory feedback: the farmer says why an answer was not useful.
 * Ownership is part of the lookup — another user's row is indistinguishable
 * from a missing one (404, no existence oracle). A second report OVERWRITES
 * the first: a farmer refining "not clear" into the concrete crop problem must
 * not be blocked, and there is exactly one feedback slot per advisory; the
 * latest assessment wins (documented in docs/ai.md). Each write is audited.
 */
aiRouter.post(
  "/history/:id/feedback",
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({ reason: z.string().trim().min(3).max(500) }),
  }),
  async (req, res, next) => {
    try {
      const { id } = req.params as unknown as { id: string };
      const { reason } = req.body as { reason: string };

      const own = await prisma.advisoryQuery.findFirst({
        where: { id, userId: req.auth!.userId },
        select: { id: true },
      });
      if (!own) throw notFound("Advisory");

      const updated = await prisma.advisoryQuery.update({
        where: { id },
        data: { feedbackReason: reason, feedbackAt: new Date() },
        select: { id: true, feedbackReason: true, feedbackAt: true },
      });

      await audit({
        actorId: req.auth!.userId,
        action: "AI_ADVISORY_FEEDBACK",
        entityType: "AdvisoryQuery",
        entityId: id,
        ip: req.ip,
      });

      ok(res, updated);
    } catch (e) {
      next(e);
    }
  }
);
