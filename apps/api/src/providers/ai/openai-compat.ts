import { env } from "../../config/env.js";
import { AiContext, AiAnswer, expertVerificationNote, LOW_CONFIDENCE_THRESHOLD, AiProvider } from "./types.js";
import { retrieve, sanitizeQuestion } from "./knowledge.js";

/**
 * Adapter for any OpenAI-compatible chat completions API.
 * System prompt is hardened against prompt injection; retrieved KB entries
 * are injected as grounding context and the model is instructed to refuse
 * when context is insufficient (hallucination mitigation, Section 33/55).
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly name = "openai-compatible";
  readonly model = env.OPENAI_MODEL;

  async ask(question: string, ctx: AiContext): Promise<AiAnswer> {
    const sanitized = sanitizeQuestion(question);
    const { entries } = retrieve(sanitized.toLowerCase(), ctx.cropName);
    const grounding = entries
      .map((e) => `[KB:${e.id}] ${ctx.lang === "bn" ? e.answerBn : e.answerEn}`)
      .join("\n\n");

    const system = [
      "You are the AgroBridge AI Agro Agent serving Bangladeshi farmers.",
      "Answer ONLY from the GROUNDED KNOWLEDGE and FARM CONTEXT provided. If insufficient, say you are not certain and recommend contacting a DAE agronomist.",
      "Never invent pesticide/fertiliser dosages. Never execute actions (orders/payments). Respond in Bengali if lang=bn else English.",
      `Farmer language preference: ${ctx.lang}.`,
      ctx.cropName ? `Current crop: ${ctx.cropName}${ctx.cropStage ? ` (${ctx.cropStage})` : ""}.` : "",
      ctx.district ? `District: ${ctx.district}.` : "",
      ctx.weatherSummary ? `Weather now: ${ctx.weatherSummary}` : "",
      grounding ? `\nGROUNDED KNOWLEDGE:\n${grounding}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const res = await fetch(`${env.OPENAI_BASE_URL}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(20_000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.2,
        max_tokens: 600,
        messages: [
          { role: "system", content: system },
          { role: "user", content: sanitized },
        ],
      }),
    });

    if (!res.ok) throw new Error(`AI provider error ${res.status}`);
    const j = (await res.json()) as { choices: { message: { content: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    let answer = j.choices[0]?.message?.content?.trim() ?? "";
    const usage = j.usage;

    // Confidence heuristic: grounded answers score higher; ungrounded capped low.
    const confidence = grounding ? 0.75 : 0.45;
    const lowConfidenceFlag = confidence < LOW_CONFIDENCE_THRESHOLD;
    if (lowConfidenceFlag) answer += expertVerificationNote(ctx.lang);

    return {
      answer,
      confidence,
      provider: this.name,
      model: this.model,
      lowConfidenceFlag,
      groundedRefs: entries.map((e) => e.id),
      tokensIn: usage?.prompt_tokens,
      tokensOut: usage?.completion_tokens,
    };
  }
}
