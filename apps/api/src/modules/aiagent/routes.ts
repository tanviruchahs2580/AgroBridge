import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { askAgroAgent } from "../../providers/ai/gateway.js";
import { KNOWLEDGE_BASE, canonicalCropOf, sourceRefOf, type KbSourceRef } from "../../providers/ai/knowledge.js";
import { prisma } from "../../lib/prisma.js";
import { logger } from "../../lib/logger.js";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ok } from "../../middleware/context.js";
import { env } from "../../config/env.js";
import { createRedisStore } from "../../lib/rateLimitRedis.js";
import { rateLimitHandler } from "../../middleware/rateLimitResponse.js";
import { userOrIpKey } from "../../middleware/rateLimitKeys.js";
import { audit } from "../../middleware/audit.js";
import { notFound } from "../../shared/errors/index.js";
import { getAuth } from "../../shared/auth-context.js";
import { advisoryHourlyLimitForTier } from "./limits.js";

export const aiRouter = Router();
aiRouter.use(requireAuth);

/**
 * Membership tier that decides this account's advisory quota (F-62). Read from
 * the database — never from the request — and any error falls back to the base
 * tier so a failure can never grant a larger quota.
 */
async function advisoryTierOf(userId: string): Promise<string | undefined> {
  try {
    const profile = await prisma.farmerProfile.findUnique({
      where: { userId },
      select: { membershipTier: true },
    });
    return profile?.membershipTier ?? undefined;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "membership tier lookup failed for the AI quota — using the base limit");
    return undefined;
  }
}

// AI endpoints are expensive -> stricter limit than global. The custom handler
// keeps this limiter's message but wraps it in the standard error envelope with
// the request id, so a throttled caller is still correlatable.
const aiStore = env.REDIS_URL ? createRedisStore(env.REDIS_URL, 60 * 60 * 1000, "ai-advisory") : undefined;
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  // Operator-tunable base (documented in .env.example) multiplied by the
  // caller's membership tier: BRONZE ×1, SILVER ×4, GOLD ×10. Previously a flat
  // limit for every account while the paid tier benefits promised "Unlimited AI
  // advisory" (F-62) — the promise is gone and the grant is real.
  limit: async (req) => advisoryHourlyLimitForTier(await advisoryTierOf(getAuth(req).userId), env.AI_HOURLY_LIMIT),
  standardHeaders: true,
  legacyHeaders: false,
  store: aiStore,
  // The quota is per account (F-03): under carrier-grade NAT an IP key would
  // charge every customer for one shared budget. requireAuth runs first.
  keyGenerator: userOrIpKey,
  handler: rateLimitHandler,
  message: { ok: false, error: { code: "RATE_LIMITED", message: "AI advisory limit reached for this hour. Please try later." } },
});

/**
 * Farm/farmer context for one advisory request (F-07 extraction): the farmer
 * row, their newest farm's active crop cycle and the canonical crop vocabulary
 * key. Only canonical keys ("rice", "wheat", …) leave this function — an
 * unrecognised client value is dropped in favour of the farm's active crop,
 * and an unrecognised farm value is dropped entirely (no ranking hint). The
 * provider sanitises the field again — defence in depth.
 */
async function advisoryContextOf(userId: string, cropName?: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
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
  return {
    farmerName: user?.fullName,
    cropName: canonicalCropOf(cropName) ?? canonicalCropOf(activeCrop?.cropName),
    cropStage: activeCrop?.stage,
    district: user?.farmerProfile?.district ?? farm?.district ?? undefined,
    membershipTier: user?.farmerProfile?.membershipTier,
  };
}

aiRouter.post(
  "/advisory",
  aiLimiter,
  validate({
    body: z.object({
      question: z.string().trim().min(5).max(1000),
      lang: z.enum(["bn", "en"]).default("bn"),
      // F-07: user-supplied and previously interpolated raw into the hosted
      // system prompt. Reject control characters / line separators outright —
      // no legitimate crop name contains them — and allow-list the value
      // against the known crop vocabulary below.
      cropName: z
        .string()
        .trim()
        .max(80)
        // eslint-disable-next-line no-control-regex -- rejecting C0/C1 controls and line separators is the point (F-07)
        .refine((v) => !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(v), "cropName must be a single line")
        .optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { question, lang, cropName } = req.body as { question: string; lang: "bn" | "en"; cropName?: string };
      const userId = getAuth(req).userId;
      const context = await advisoryContextOf(userId, cropName);

      const answer = await askAgroAgent(question, {
        userId,
        requestId: req.requestId,
        lang,
        ...context,
      });

      ok(res, {
        ...answer,
        // Citations resolved against the live corpus (A3-01): the ids the engine
        // retrieved plus their human-readable metadata. Additive field — clients
        // that only read `groundedRefs` are unaffected.
        groundedSources: answer.groundedSources ?? liveGroundedSources(answer.groundedRefs),
      });
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

/**
 * Live citation metadata for a set of grounded ids (A3-01). Unknown ids — an
 * entry removed after the answer was stored — resolve to nothing rather than to
 * a guessed title, and the order of the incoming ids is preserved.
 */
export function liveGroundedSources(ids: string[]): KbSourceRef[] {
  const byId = new Map(KNOWLEDGE_BASE.map((e) => [e.id, e]));
  const out: KbSourceRef[] = [];
  for (const id of ids) {
    const entry = byId.get(id);
    if (entry) out.push(sourceRefOf(entry));
  }
  return out;
}

aiRouter.get("/history", async (req, res, next) => {
  try {
    const rows = await prisma.advisoryQuery.findMany({
      where: { userId: getAuth(req).userId },
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
    const history = rows.map(({ groundedRefs, ...row }) => {
      const refs = liveGroundedRefs(groundedRefs);
      return { ...row, groundedRefs: refs, groundedSources: liveGroundedSources(refs) };
    });
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
        where: { id, userId: getAuth(req).userId },
        select: { id: true },
      });
      if (!own) throw notFound("Advisory");

      const updated = await prisma.advisoryQuery.update({
        where: { id },
        data: { feedbackReason: reason, feedbackAt: new Date() },
        select: { id: true, feedbackReason: true, feedbackAt: true },
      });

      await audit({
        actorId: getAuth(req).userId,
        action: "AI_ADVISORY_FEEDBACK",
        entityType: "AdvisoryQuery",
        entityId: id,
        ip: req.ip,
      });

      // Ops signal (P3: the feedback had no consumer beyond the owner). A
      // stable, queryable line — id + actor + reason LENGTH, never the free
      // text, which may carry the farmer's own details and must stay on the
      // owner-scoped row. The audit row above is the durable trail; a dedicated
      // ops queue endpoint belongs to the admin module.
      logger.info({ advisoryId: id, actorId: getAuth(req).userId, reasonChars: reason.length }, "ai advisory feedback received");

      ok(res, updated);
    } catch (e) {
      next(e);
    }
  }
);
