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

/**
 * Monthly spend guard: when accumulated estimated cost crosses the budget the
 * expensive provider is refused. Non-production runs fall back to the offline
 * engine (free); production surfaces 429 AI_BUDGET_EXCEEDED so answers are
 * never silently degraded without an explicit operator decision. The window
 * resets naturally each calendar month.
 */
async function monthlyBudgetExceeded(): Promise<boolean> {
  if (env.AI_COST_PER_1K_TOKENS_PAISA === 0) return false;
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const agg = await prisma.aiUsageLog.aggregate({
    where: { createdAt: { gte: startOfMonth }, provider: "openai-compatible" },
    _sum: { costEstimatePaisa: true },
  });
  return (agg._sum.costEstimatePaisa ?? 0) >= env.AI_MONTHLY_BUDGET_PAISA;
}

/** AI Gateway: single entry point with usage logging + explicit failure chain.*/
export async function askAgroAgent(
  question: string,
  ctx: AiContext & { userId?: string; requestId?: string },
): Promise<AiAnswer> {
  let provider = resolveProvider();
  if (provider.name === "openai-compatible" && (await monthlyBudgetExceeded())) {
    if (isProd) {
      const { AppError } = await import("../../shared/errors/index.js");
      throw new AppError(429, "AI_BUDGET_EXCEEDED", "AI monthly budget exceeded");
    }
    logger.warn("AI monthly budget exceeded — serving from offline engine");
    aiRequestsTotal.inc({ provider: "offline-engine", status: "budget_fallback" });
    provider = new OfflineAgroEngine();
  }
  const started = Date.now();

  try {
    const answer = await provider.ask(question, ctx);
    aiRequestsTotal.inc({ provider: answer.provider, status: "success" });
    await logUsage({
      userId: ctx.userId,
      requestId: ctx.requestId,
      provider: answer.provider,
      model: answer.model,
      kbVersion: answer.kbVersion,
      promptVersion: answer.promptVersion,
      latencyMs: Date.now() - started,
      success: true,
      tokensIn: answer.tokensIn,
      tokensOut: answer.tokensOut,
    });
    await persistQuery(ctx.userId, question, answer, ctx.requestId);
    return answer;
  } catch (err) {
    // Error context names the prompt template version in play, so a
    // failing hosted-provider call is attributable to a prompt revision.
    logger.warn(
      { err: (err as Error).message, provider: provider.name, promptVersion: provider.promptVersion },
      "primary AI provider failed",
    );
    if (isProd) {
      const { markDown } = await import("../health.js");
      markDown("ai", (err as Error).message);
      const { AppError } = await import("../../shared/errors/index.js");
      throw new AppError(502, "AI_PROVIDER_UNAVAILABLE", "AI provider unavailable");
    }
    const fallback = new OfflineAgroEngine();
    const answer = await fallback.ask(question, ctx);
    aiRequestsTotal.inc({ provider: fallback.name, status: "fallback_success" });
    await logUsage({ userId: ctx.userId, requestId: ctx.requestId, provider: fallback.name, model: fallback.model, kbVersion: answer.kbVersion, latencyMs: Date.now() - started, success: true });
    await persistQuery(ctx.userId, question, answer, ctx.requestId);
    return answer;
  }
}

/**
 * Usage telemetry. The lineage columns (kbVersion, requestId) exist since the
 * 2026-10-19 provenance wave, so an AI request can be joined to the KB corpus
 * and the HTTP request that produced it; promptVersion has no column here (it
 * lives on the persisted advisory row) and still rides the debug line.
 */
async function logUsage(p: {
  userId?: string;
  requestId?: string;
  provider: string;
  model: string;
  kbVersion?: string;
  promptVersion?: string;
  latencyMs: number;
  success: boolean;
  tokensIn?: number;
  tokensOut?: number;
}) {
  logger.debug(
    { provider: p.provider, model: p.model, kbVersion: p.kbVersion, promptVersion: p.promptVersion, latencyMs: p.latencyMs, success: p.success },
    "ai usage",
  );
  try {
    const tokens = (p.tokensIn ?? 0) + (p.tokensOut ?? 0);
    const costEstimatePaisa =
      p.provider === "openai-compatible"
        ? Math.ceil((tokens / 1000) * env.AI_COST_PER_1K_TOKENS_PAISA)
        : 0;
    await prisma.aiUsageLog.create({
      data: {
        userId: p.userId,
        requestId: p.requestId,
        kbVersion: p.kbVersion,
        provider: p.provider,
        model: p.model,
        latencyMs: p.latencyMs,
        success: p.success,
        ...(tokens > 0 ? { tokensIn: p.tokensIn, tokensOut: p.tokensOut } : {}),
        costEstimatePaisa,
      },
    });
  } catch {
    // never fail a user request because of telemetry
  }
}

async function persistQuery(userId: string | undefined, question: string, answer: AiAnswer, requestId?: string) {
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
        kbVersion: answer.kbVersion,
        promptVersion: answer.promptVersion,
        requestId,
      },
    });
  } catch (e) {
    if (!isProd) logger.debug({ err: (e as Error).message }, "advisory persist skipped");
  }
}
