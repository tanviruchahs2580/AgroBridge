import { env, isProd } from "../../config/env.js";
import { dhakaMonthStart } from "../../shared/utils/dhakaMonth.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { aiRequestsTotal } from "../../lib/metrics.js";
import { OfflineAgroEngine } from "./offline-engine.js";
import { OpenAiCompatibleProvider, MAX_OUTPUT_TOKENS } from "./openai-compat.js";
import { AiAnswer, AiContext, AiProvider } from "./types.js";

export * from "./types.js";

function resolveProvider(): AiProvider {
  if (env.AI_PROVIDER === "openai-compatible" && env.OPENAI_API_KEY) {
    return new OpenAiCompatibleProvider();
  }
  return new OfflineAgroEngine();
}

/**
 * Budget-guard parameters. F-22 registered these because the guard previously
 * had two unmetered spend routes (a provider that omits `usage`, and a
 * swallowed telemetry write) and a check-then-act race between the budget check
 * and the post-call cost write.
 */
export const BUDGET_GUARD = {
  /**
   * Worst-case prompt-size allowance (chars) carried in the pre-call
   * reservation: the question plus the reference block (up to two KB answers in
   * both scripts plus farm context) plus the fixed instructions.
   */
  reservedPromptChars: 8_000,
  /** Chars-per-token approximation for estimating figures a provider omits. */
  charsPerToken: 4,
} as const;

export function estimateTokensFromChars(chars: number): number {
  return Math.ceil(Math.max(0, chars) / BUDGET_GUARD.charsPerToken);
}

/** Upper-bound cost (paisa) of one hosted call — the reservation amount. */
export function worstCaseCostPaisa(questionChars: number): number {
  const tokens = estimateTokensFromChars(questionChars + BUDGET_GUARD.reservedPromptChars) + MAX_OUTPUT_TOKENS;
  return Math.ceil((tokens / 1000) * env.AI_COST_PER_1K_TOKENS_PAISA);
}

/**
 * Sum of estimated cost recorded for hosted calls in the current Dhaka month.
 * Exported (with an injectable `now`) so the monthly window itself is testable:
 * the audit found the window-to-guard wiring had no test at all (F-22).
 */
export async function monthlySpendPaisa(now: Date = new Date()): Promise<number> {
  const agg = await prisma.aiUsageLog.aggregate({
    where: { createdAt: { gte: dhakaMonthStart(now) }, provider: "openai-compatible" },
    _sum: { costEstimatePaisa: true },
  });
  return agg._sum.costEstimatePaisa ?? 0;
}

interface BudgetAdmission {
  /** `aiUsageLog` row holding this call's worst-case reservation. */
  id: string;
  reservedPaisa: number;
}

type AdmissionResult =
  | { ok: true; reservation: BudgetAdmission | null }
  | { ok: false; reason: "budget" | "metering" };

/**
 * Reserve-then-check admission for the hosted provider.
 *
 * The reservation row is inserted FIRST and the monthly sum is read AFTER, so
 * concurrent in-flight requests see each other's worst-case cost: the old
 * check-then-act sequence let N concurrent requests all pass a pre-call budget
 * check. The overshoot bound is "in-flight reservations", and any crash leaves
 * a reservation on the books — the guard can trip early, never late.
 *
 * If the reservation cannot be written the hosted call is refused: a request we
 * cannot meter must not spend (fail closed).
 */
async function admitHostedCall(p: { userId?: string; requestId?: string; questionChars: number }): Promise<AdmissionResult> {
  if (env.AI_COST_PER_1K_TOKENS_PAISA === 0) {
    // Inert money guard. Production refuses AI_PROVIDER=openai-compatible with
    // a zero tariff at startup (`hostedAiCostProblem`), so this combination is
    // dev/test-only.
    return { ok: true, reservation: null };
  }
  const reservedPaisa = worstCaseCostPaisa(p.questionChars);
  let row: { id: string };
  try {
    row = await prisma.aiUsageLog.create({
      data: {
        userId: p.userId,
        requestId: p.requestId,
        provider: "openai-compatible",
        model: env.OPENAI_MODEL,
        latencyMs: 0,
        success: false,
        costEstimatePaisa: reservedPaisa,
      },
      select: { id: true },
    });
  } catch (err) {
    logger.error(
      { err: (err as Error).message, requestId: p.requestId },
      "AI usage metering unavailable — refusing the hosted provider (a request the guard cannot meter must not spend)",
    );
    return { ok: false, reason: "metering" };
  }

  const spent = await monthlySpendPaisa();
  if (spent >= env.AI_MONTHLY_BUDGET_PAISA) {
    await dropReservation(row.id, p.requestId);
    return { ok: false, reason: "budget" };
  }
  return { ok: true, reservation: { id: row.id, reservedPaisa } };
}

async function dropReservation(id: string, requestId?: string): Promise<void> {
  try {
    await prisma.aiUsageLog.delete({ where: { id } });
  } catch (err) {
    // Leaving the row behind only over-counts spend (fail closed).
    logger.error({ err: (err as Error).message, requestId }, "AI budget reservation could not be released");
  }
}

/**
 * Token figures for the usage ledger. A hosted provider that omits `usage`
 * (or reports only one side) gets its figures estimated from the text lengths
 * and the reserved prompt allowance, so spend is never recorded as zero just
 * because a provider did not say what it used (F-22).
 */
function meteredTokens(a: AiAnswer, questionChars: number, answerChars: number): { tokensIn?: number; tokensOut?: number; estimated: boolean } {
  if (a.provider !== "openai-compatible") return { tokensIn: a.tokensIn, tokensOut: a.tokensOut, estimated: false };
  if (a.tokensIn !== undefined && a.tokensOut !== undefined) return { tokensIn: a.tokensIn, tokensOut: a.tokensOut, estimated: false };
  return {
    tokensIn: a.tokensIn ?? estimateTokensFromChars(questionChars + BUDGET_GUARD.reservedPromptChars),
    tokensOut: a.tokensOut ?? estimateTokensFromChars(answerChars),
    estimated: true,
  };
}

function costOfTokens(tokensIn: number | undefined, tokensOut: number | undefined): number {
  const tokens = (tokensIn ?? 0) + (tokensOut ?? 0);
  if (tokens <= 0) return 0;
  return Math.ceil((tokens / 1000) * env.AI_COST_PER_1K_TOKENS_PAISA);
}

/** One usage-ledger write: settle the reservation if there is one, else record offline. */
async function settleOrInsertUsage(
  reservation: BudgetAdmission | null,
  w: {
    requestId?: string;
    userId?: string;
    kbVersion: string;
    provider: string;
    model: string;
    latencyMs: number;
    tokensIn?: number;
    tokensOut?: number;
    costEstimatePaisa: number;
  },
): Promise<void> {
  if (reservation) {
    await prisma.aiUsageLog.update({
      where: { id: reservation.id },
      data: {
        // The served model (when the provider reports one) is the fact; the
        // configured id is a mutable alias a provider may resolve or roll.
        model: w.model,
        latencyMs: w.latencyMs,
        success: true,
        tokensIn: w.tokensIn,
        tokensOut: w.tokensOut,
        costEstimatePaisa: w.costEstimatePaisa,
        kbVersion: w.kbVersion,
      },
    });
    return;
  }
  await prisma.aiUsageLog.create({
    data: {
      userId: w.userId,
      requestId: w.requestId,
      kbVersion: w.kbVersion,
      provider: w.provider,
      model: w.model,
      latencyMs: w.latencyMs,
      success: true,
      ...(w.tokensIn === undefined && w.tokensOut === undefined ? {} : { tokensIn: w.tokensIn, tokensOut: w.tokensOut }),
      costEstimatePaisa: w.costEstimatePaisa,
    },
  });
}

/**
 * Settles a hosted call's reservation with its real (or estimated) figures, or
 * records a full offline row. Telemetry must never fail a user request, but a
 * failure is now logged at error level with the request id instead of being
 * swallowed — the previous silent `catch` erased spend from the monthly sum
 * with no signal at all (F-22).
 */
async function recordUsage(
  reservation: BudgetAdmission | null,
  p: { answer: AiAnswer; latencyMs: number; questionChars: number; requestId?: string; userId?: string; membershipTier?: string },
): Promise<void> {
  const { answer } = p;
  const tokens = meteredTokens(answer, p.questionChars, answer.answer.length);
  const costEstimatePaisa = costOfTokens(tokens.tokensIn, tokens.tokensOut);
  const model = answer.responseModel ?? answer.model;
  logger.debug(
    {
      provider: answer.provider,
      model: answer.model,
      responseModel: answer.responseModel,
      systemFingerprint: answer.systemFingerprint,
      kbVersion: answer.kbVersion,
      promptVersion: answer.promptVersion,
      membershipTier: p.membershipTier,
      latencyMs: p.latencyMs,
      tokensIn: tokens.tokensIn,
      tokensOut: tokens.tokensOut,
      tokensEstimated: tokens.estimated,
      costEstimatePaisa,
      success: true,
    },
    "ai usage",
  );
  try {
    await settleOrInsertUsage(reservation, {
      requestId: p.requestId,
      userId: p.userId,
      kbVersion: answer.kbVersion,
      provider: answer.provider,
      model,
      latencyMs: p.latencyMs,
      tokensIn: tokens.tokensIn,
      tokensOut: tokens.tokensOut,
      costEstimatePaisa,
    });
    if (reservation && tokens.estimated) {
      logger.warn({ requestId: p.requestId }, "hosted provider omitted token usage — usage ledger figures estimated");
    }
  } catch (err) {
    logger.error(
      { err: (err as Error).message, requestId: p.requestId, provider: answer.provider },
      "AI usage write failed — spend may not be reflected in the monthly guard",
    );
  }
}

/** A failed hosted call keeps its worst-case reservation: the provider may have
 *  consumed tokens before failing, and the guard must not learn about spend late. */
async function recordFailure(reservation: BudgetAdmission | null, p: { provider: string; model: string; latencyMs: number; requestId?: string; userId?: string }): Promise<void> {
  try {
    if (reservation) {
      await prisma.aiUsageLog.update({
        where: { id: reservation.id },
        data: { latencyMs: p.latencyMs, success: false, costEstimatePaisa: reservation.reservedPaisa },
      });
      return;
    }
    await prisma.aiUsageLog.create({
      data: {
        userId: p.userId,
        requestId: p.requestId,
        provider: p.provider,
        model: p.model,
        latencyMs: p.latencyMs,
        success: false,
        costEstimatePaisa: 0,
      },
    });
  } catch (err) {
    logger.error({ err: (err as Error).message, requestId: p.requestId }, "AI usage write failed for a failed call");
  }
}

/**
 * The provider for one request, applying the budget admission when the hosted
 * provider is selected. In production a refusal is an error (429/503); outside
 * production it falls back to the free deterministic engine, and no production
 * path silently degrades.
 */
async function admitProvider(
  ctx: AiContext & { userId?: string; requestId?: string },
  questionChars: number,
): Promise<{ provider: AiProvider; reservation: BudgetAdmission | null }> {
  const provider = resolveProvider();
  if (provider.name !== "openai-compatible") return { provider, reservation: null };

  const admission = await admitHostedCall({ userId: ctx.userId, requestId: ctx.requestId, questionChars });
  if (admission.ok) return { provider, reservation: admission.reservation };

  if (isProd) {
    const { AppError } = await import("../../shared/errors/index.js");
    if (admission.reason === "budget") throw new AppError(429, "AI_BUDGET_EXCEEDED", "AI monthly budget exceeded");
    throw new AppError(503, "AI_METERING_UNAVAILABLE", "AI usage metering unavailable");
  }
  // Non-production, non-critical path: fall back to the free offline engine
  // rather than silently degrading in production (unchanged production semantics).
  const fallback = new OfflineAgroEngine();
  logger.warn({ reason: admission.reason, requestId: ctx.requestId }, "AI budget guard refused the hosted provider — serving from the offline engine");
  aiRequestsTotal.inc({ provider: fallback.name, status: admission.reason === "budget" ? "budget_fallback" : "metering_fallback" });
  return { provider: fallback, reservation: null };
}

/** AI Gateway: single entry point with usage logging + explicit failure chain.*/
export async function askAgroAgent(
  question: string,
  ctx: AiContext & { userId?: string; requestId?: string },
): Promise<AiAnswer> {
  const { provider, reservation } = await admitProvider(ctx, question.length);
  const started = Date.now();

  try {
    const answer = await provider.ask(question, ctx);
    aiRequestsTotal.inc({ provider: answer.provider, status: "success" });
    await recordUsage(reservation, {
      answer,
      latencyMs: Date.now() - started,
      questionChars: question.length,
      requestId: ctx.requestId,
      userId: ctx.userId,
      membershipTier: ctx.membershipTier,
    });
    await persistQuery(ctx.userId, question, answer, ctx.requestId);
    return answer;
  } catch (err) {
    await recordFailure(reservation, { provider: provider.name, model: provider.model, latencyMs: Date.now() - started, requestId: ctx.requestId, userId: ctx.userId });
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
    await recordUsage(null, {
      answer,
      latencyMs: Date.now() - started,
      questionChars: question.length,
      requestId: ctx.requestId,
      userId: ctx.userId,
      membershipTier: ctx.membershipTier,
    });
    await persistQuery(ctx.userId, question, answer, ctx.requestId);
    return answer;
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
    // Never fail a served request over a history write — but never lose it
    // silently either: a missing advisory row is unrecoverable user-visible
    // data loss, so it is an error in production too (previously swallowed in
    // prod and logged at debug only outside it).
    logger.error(
      { err: (e as Error).message, requestId, provider: answer.provider },
      "advisory persist failed — the answer was served but its history row was not written",
    );
  }
}
