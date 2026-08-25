import { env, isProd } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { aiRequestsTotal } from "../../lib/metrics.js";
import { OfflineAgroEngine } from "./offline-engine.js";
import { OpenAiCompatibleProvider } from "./openai-compat.js";
import { AiAnswer, AiContext, AiProvider } from "./types.js";

export * from "./types.js";

function resolveProvider(): AiProvider {
  if (env.AI_PROVIDER === "openai-compatible" && env.OPENAI_API_KEY) {
    return new OpenAiCompatibleProvider();
  }
  return new OfflineAgroEngine();
}

/** AI Gateway: single entry point with usage logging + graceful fallback (Section 33/55). */
export async function askAgroAgent(question: string, ctx: AiContext & { userId?: string }): Promise<AiAnswer> {
  const provider = resolveProvider();
  const started = Date.now();

  try {
    const answer = await provider.ask(question, ctx);
    aiRequestsTotal.inc({ provider: answer.provider, status: "success" });
    await logUsage({ userId: ctx.userId, provider: answer.provider, model: answer.model, latencyMs: Date.now() - started, success: true });
    await persistQuery(ctx.userId, question, answer);
    return answer;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "primary AI provider failed; falling back to offline engine");
    const fallback = new OfflineAgroEngine();
    const answer = await fallback.ask(question, ctx);
    aiRequestsTotal.inc({ provider: fallback.name, status: "fallback_success" });
    await logUsage({ userId: ctx.userId, provider: fallback.name, model: fallback.model, latencyMs: Date.now() - started, success: true });
    await persistQuery(ctx.userId, question, answer);
    return answer;
  }
}

async function logUsage(p: { userId?: string; provider: string; model: string; latencyMs: number; success: boolean }) {
  try {
    await prisma.aiUsageLog.create({
      data: {
        userId: p.userId,
        provider: p.provider,
        model: p.model,
        latencyMs: p.latencyMs,
        success: p.success,
      },
    });
  } catch {
    // never fail a user request because of telemetry
  }
}

async function persistQuery(userId: string | undefined, question: string, answer: AiAnswer) {
  if (!userId) return;
  try {
    await prisma.advisoryQuery.create({
      data: {
        userId,
        question,
        answer: answer.answer,
        confidence: answer.confidence,
        provider: answer.provider,
        model: answer.model,
        lowConfidenceFlag: answer.lowConfidenceFlag,
        groundedRefs: JSON.stringify(answer.groundedRefs),
      },
    });
  } catch (e) {
    if (!isProd) logger.debug({ err: (e as Error).message }, "advisory persist skipped");
  }
}
