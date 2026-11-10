import { env } from "../../config/env.js";
import { withResilience } from "../resilience.js";
import {
  AiContext,
  AiAnswer,
  expertVerificationNote,
  unreviewedTreatmentNote,
  unreviewedTreatmentRequired,
  AiProvider,
  AiProviderError,
} from "./types.js";
import { retrieve, sanitizeQuestion, KB_VERSION, sourceRefOf } from "./knowledge.js";
import { assessHostedAnswer } from "./scoring.js";
import { buildChatMessages, type ChatMessage } from "./prompt.js";

export { buildChatMessages };
export type { ChatMessage };

/**
 * Version of the prompt template in this file (system prompt + reference-data
 * framing). Bump whenever the prompt changes materially:
 * answers are only comparable — for evals, for incident review — when the
 * prompt that produced them is identifiable. Reported in the response as
 * `promptVersion` and in gateway log context; the offline engine has no prompt
 * and omits the field (`kb-retrieval-v1` is its template identity).
 *
 * v2 — F-07 restructure: farm context (crop/stage/district/weather) moved from
 * the instruction region into the delimited untrusted-reference block, and the
 * language line is now a fixed literal per enum value; v1 interpolated the raw
 * user-supplied crop name above the fence.
 */
export const PROMPT_VERSION = "v2";

/**
 * Adapter for any OpenAI-compatible chat completions API.
 * System prompt is hardened against prompt injection; retrieved KB entries
 * are injected as clearly-delimited reference data and the model is instructed
 * to refuse when context is insufficient (hallucination mitigation).
 *
 * Failure taxonomy: empty or blocked/truncated generations
 * are typed errors, never confident answers; 429 vs 5xx vs other non-2xx are
 * distinguished; exactly ONE bounded retry runs for retryable failures
 * (429/5xx) — the request is read-only, so a repeat cannot duplicate an effect.
 * The retry loop itself lives in the shared resilience policy, pinned to this
 * adapter's taxonomy through `isRetryable` (see providers/resilience.ts).
 */
const RETRY_DELAY_MS = 300;
const REQUEST_TIMEOUT_MS = 20_000;
/** Output cap requested from the provider; also the gateway's reservation basis. */
export const MAX_OUTPUT_TOKENS = 600;

interface ChatCompletionBody {
  choices?: { message?: { content?: string }; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  /** Provider-reported serving model — may differ from the requested alias. */
  model?: unknown;
  system_fingerprint?: unknown;
}

function statusError(status: number): AiProviderError {
  if (status === 429) return new AiProviderError("RATE_LIMITED", "AI provider rate limited (HTTP 429)", status, true);
  if (status >= 500) return new AiProviderError("UPSTREAM", `AI provider upstream error (HTTP ${status})`, status, true);
  return new AiProviderError("UPSTREAM", `AI provider error (HTTP ${status})`, status, false);
}

/**
 * Provider-reported metadata is untrusted input: force it to one line, strip
 * control characters and cap the length before it reaches the usage ledger or
 * a log line (a hostile provider must not be able to forge log records).
 */
function providerText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value
    // eslint-disable-next-line no-control-regex -- stripping controls is the point
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .trim()
    .slice(0, maxLength);
  return clean.length > 0 ? clean : undefined;
}

/** Provider body → typed result. Malformed JSON is an upstream failure. */
async function readChatBody(res: Response): Promise<ChatCompletionBody> {
  try {
    return (await res.json()) as ChatCompletionBody;
  } catch {
    throw new AiProviderError("UPSTREAM", "AI provider returned a malformed JSON body");
  }
}

/**
 * The served completion, or a typed failure. A blocked, truncated or empty
 * generation is never served as an answer.
 */
function extractCompletion(body: ChatCompletionBody): { answer: string; usage: ChatCompletionBody["usage"] } {
  const choice = body.choices?.[0];
  if (choice?.finish_reason === "content_filter") {
    throw new AiProviderError("CONTENT_FILTERED", "AI provider blocked the output (finish_reason=content_filter)");
  }
  const raw = choice?.message?.content ?? "";
  if (!raw.trim()) {
    throw new AiProviderError("EMPTY_CONTENT", "AI provider returned an empty answer — refusing to serve it as grounded");
  }
  if (choice?.finish_reason === "length") {
    throw new AiProviderError("TRUNCATED", "AI provider response was truncated (finish_reason=length)");
  }
  return { answer: raw.trim(), usage: body.usage };
}

export class OpenAiCompatibleProvider implements AiProvider {
  readonly name = "openai-compatible";
  readonly model = env.OPENAI_MODEL;
  readonly promptVersion = PROMPT_VERSION;
  private readonly retryDelayMs: number;

  constructor(opts: { retryDelayMs?: number } = {}) {
    this.retryDelayMs = opts.retryDelayMs ?? RETRY_DELAY_MS;
  }

  async ask(question: string, ctx: AiContext): Promise<AiAnswer> {
    const sanitized = sanitizeQuestion(question);
    const { entries, scores } = retrieve(sanitized.toLowerCase(), ctx.cropName);
    const messages = buildChatMessages(sanitized, ctx, entries);

    const res = await withResilience(
      "openai-compatible",
      async (signal) => {
        const r = await this.post(messages, signal);
        if (!r.ok) throw statusError(r.status);
        return r;
      },
      {
        timeoutMs: REQUEST_TIMEOUT_MS,
        retries: 1,
        retryDelayMs: this.retryDelayMs,
        // Strictly this adapter's policy: only the classes typed as retryable
        // (429/5xx) repeat; a timeout or transport failure stays single-attempt.
        isRetryable: (err) => err instanceof AiProviderError && err.retryable,
      }
    );

    const body = await readChatBody(res);
    const { answer, usage } = extractCompletion(body);

    // F-43: confidence is derived from retrieval evidence plus an answer-support
    // check, not the old fixed 0.75/0.45. An answer the retrieved text cannot
    // support is downgraded to low-confidence and loses its citations — the
    // honest outcome, never "Source match: good" over parametric memory.
    const assessment = assessHostedAnswer(answer, entries, scores, ctx.lang);
    const refs = assessment.supported ? entries.map((e) => e.id) : [];
    const sources = assessment.supported ? entries.map(sourceRefOf) : [];

    let text = answer;
    if (assessment.lowConfidenceFlag) {
      text += expertVerificationNote(ctx.lang);
    }
    // F-44: the same unreviewed-agrochemical guard the offline engine applies.
    // This is the one path that can invent a dose from parametric memory, so
    // an ungrounded answer that names/doses an input is always flagged.
    if (unreviewedTreatmentRequired(answer, entries)) {
      text += unreviewedTreatmentNote(ctx.lang);
    }

    return {
      answer: text,
      confidence: assessment.confidence,
      provider: this.name,
      model: this.model,
      lowConfidenceFlag: assessment.lowConfidenceFlag,
      groundedRefs: refs,
      groundedSources: sources,
      tokensIn: usage?.prompt_tokens,
      tokensOut: usage?.completion_tokens,
      kbVersion: KB_VERSION,
      promptVersion: PROMPT_VERSION,
      responseModel: providerText(body.model, 80),
      systemFingerprint: providerText(body.system_fingerprint, 80),
      ...(assessment.support === null ? {} : { answerSupport: Number(assessment.support.toFixed(3)) }),
    };
  }

  /** Single HTTP attempt; transport errors and timeouts become typed errors. */
  private async post(messages: ChatMessage[], signal: AbortSignal): Promise<Response> {
    try {
      return await fetch(`${env.OPENAI_BASE_URL}/chat/completions`, {
        method: "POST",
        signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          max_tokens: MAX_OUTPUT_TOKENS,
          messages,
        }),
      });
    } catch (err) {
      // AbortSignal.timeout rejects with TimeoutError in Node; a caller-driven
      // abort (and the adapter's test double) surfaces as AbortError — both
      // mean the request ran out of time.
      const name = (err as { name?: string })?.name;
      if (name === "AbortError" || name === "TimeoutError") {
        throw new AiProviderError("TIMEOUT", `AI provider request timed out after ${REQUEST_TIMEOUT_MS}ms`);
      }
      throw new AiProviderError("UPSTREAM", `AI provider request failed: ${(err as Error).message}`);
    }
  }
}
