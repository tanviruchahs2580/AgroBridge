import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { askAgroAgent } from "../../providers/ai/gateway.js";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ok } from "../../middleware/context.js";
import { env } from "../../config/env.js";
import { createRedisStore } from "../../lib/rateLimitRedis.js";

export const aiRouter = Router();
aiRouter.use(requireAuth);

// AI endpoints are expensive -> stricter limit than global (Section 33).
const aiStore = env.REDIS_URL ? createRedisStore(env.REDIS_URL, 60 * 60 * 1000) : undefined;
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  store: aiStore,
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

      // Context extraction: farmer + active crop context (Section 13 pipeline).
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

aiRouter.get("/history", async (req, res, next) => {
  try {
    const history = await prisma.advisoryQuery.findMany({
      where: { userId: req.auth!.userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, question: true, answer: true, confidence: true, lowConfidenceFlag: true, createdAt: true },
    });
    ok(res, history);
  } catch (e) {
    next(e);
  }
});
