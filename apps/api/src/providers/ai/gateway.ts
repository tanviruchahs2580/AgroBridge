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
 * Monthly spend guard: when accumulated estimated cost crosses the budget,
 * the expensive provider is skipped and callers fall back to the offline
 * engine (which is free). Reset happens naturally each calendar month.
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

/** AI Gateway: single entry point with usage logging + explicit failure chain (Phase 4). */
export async function askAgroAgent(question: string, ctx: AiContext & { userId?: string }): Promise<AiAnswer> {
  let provider = resolveProvider();
  if (provider.name === "openai-compatible" && (await monthlyBudgetExceeded())) {
    if (isProd) {
      const { AppError } = await import("../../lib/errors.js");
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
    await logUsage({ userId: ctx.userId, provider: answer.provider, model: answer.model, latencyMs: Date.now() - started, success: true, tokensIn: answer.tokensIn, tokensOut: answer.tokensOut });
    await persistQuery(ctx.userId, question, answer);
    return answer;
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "primary AI provider failed");
    if (isProd) {
      const { markDown } = await import("../health.js");
      markDown("ai", (err as Error).message);
      const { AppError } = await import("../../lib/errors.js");
      throw new AppError(502, "AI_PROVIDER_UNAVAILABLE", "AI provider unavailable");
    }
    const fallback = new OfflineAgroEngine();
    const answer = await fallback.ask(question, ctx);
    aiRequestsTotal.inc({ provider: fallback.name, status: "fallback_success" });
    await logUsage({ userId: ctx.userId, provider: fallback.name, model: fallback.model, latencyMs: Date.now() - started, success: true });
    await persistQuery(ctx.userId, question, answer);
    return answer;
  }
}

async function logUsage(p: {
  userId?: string;
  provider: string;
  model: string;
  latencyMs: number;
  success: boolean;
  tokensIn?: number;
  tokensOut?: number;
}) {
  try {
    const tokens = (p.tokensIn ?? 0) + (p.tokensOut ?? 0);
    const costEstimatePaisa =
      p.provider === "openai-compatible"
        ? Math.ceil((tokens / 1000) * env.AI_COST_PER_1K_TOKENS_PAISA)
        : 0;
    await prisma.aiUsageLog.create({
      data: {
        userId: p.userId,
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
