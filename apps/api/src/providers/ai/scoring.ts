import type { KbEntry } from "./knowledge.js";
import { RETRIEVAL_WEIGHTS } from "./knowledge.js";
import { LOW_CONFIDENCE_THRESHOLD, type AiContext } from "./types.js";

/**
 * Score → confidence mapping for BOTH engines, in one place (F-43).
 *
 * The offline engine used to compute this inline and the hosted adapter
 * hardcoded `0.75`/`0.45` — "grounded" meant only "something was retrieved", so
 * a hosted answer that ignored the retrieved text still advertised "Source
 * match: good" with KB titles attached. Every constant here is registered (the
 * audit found the 0.75/0.45 pair unregistered in `docs/ai-parameters.md`).
 *
 * The numbers are ORDINAL support indicators, never calibrated probabilities:
 * the UI renders three coarse bands and never a percentage (A4-01).
 */
export const CONFIDENCE_PARAMS = {
  /** A bare strong single hit (score 1.5) earns this share of the entry's stored confidence. */
  matchQualityBase: 0.75,
  /** Each further point of topical evidence adds this much match quality. */
  matchQualityPerPoint: 0.125,
  /** Second retrieved entry adds this (small, guessed) amount when it corroborates the top topic. */
  multiEntryBonus: 0.03,
  /** No advisory answer is ever presented as certain. */
  maxConfidence: 0.95,
  /** Hosted answer with NO retrieved reference text: weak support, always low-confidence. */
  ungrounded: 0.45,
  /** Hosted answer whose text is not supported by the retrieved reference text. */
  unsupportedAnswer: 0.4,
  /**
   * Minimum share of an answer's content tokens that must appear in the
   * retrieved reference text for the answer to count as supported. Tuned
   * against the adapter suite, which pins both sides: a paraphrase that reuses
   * the KB's terms passes, a parametric-memory answer about a different topic
   * fails.
   */
  minAnswerSupport: 0.35,
} as const;

/**
 * `min(1, 0.75 + (topScore − strongSingleHit) × 0.125)` — the offline engine's
 * long-standing match-quality curve, extracted so both engines share it.
 */
export function matchQualityOf(topScore: number): number {
  return Math.min(1, CONFIDENCE_PARAMS.matchQualityBase + Math.max(0, topScore - RETRIEVAL_WEIGHTS.strongSingleHit) * CONFIDENCE_PARAMS.matchQualityPerPoint);
}

/**
 * Evidence-based confidence from retrieval alone: the stored per-entry
 * confidence (an authoring guess) is only earned proportionally to how much
 * topical evidence the question produced. `scores` are the topical scores from
 * `retrieve` (the farm-context hint is excluded by construction).
 */
export function retrievalConfidence(entries: KbEntry[], scores: number[]): number {
  const primary = entries[0];
  if (!primary) return 0;
  const quality = matchQualityOf(scores[0] ?? 0);
  const multi = entries.length > 1 ? CONFIDENCE_PARAMS.multiEntryBonus : 0;
  return Math.min(CONFIDENCE_PARAMS.maxConfidence, primary.confidence * quality + multi);
}

/**
 * Script-aware tokenizer for the answer-support check. Splits on anything that
 * is not a letter, digit or combining mark (`\p{M}` keeps Bengali matras and
 * the hasanta attached to their base character — a Latin `\b` regex would
 * shred Bengali words). Deterministic; no locale collation.
 */
const SUPPORT_TOKEN_RE = /[\p{L}\p{M}\p{N}]+/gu;

export function tokenizeForSupport(text: string): string[] {
  return (text.toLowerCase().match(SUPPORT_TOKEN_RE) ?? []).filter((t) => t.length >= 2);
}

/**
 * Share of the answer's content tokens that appear in the retrieved reference
 * text (the same language variants that were injected into the prompt), or
 * `null` when there is nothing to measure against (no entries / empty answer).
 *
 * This is the runtime form of the evaluation harness's `containment` metric —
 * the hosted path previously had no containment post-check at all.
 */
export function answerSupportRatio(answer: string, entries: KbEntry[], lang: AiContext["lang"]): number | null {
  if (entries.length === 0) return null;
  const reference = entries
    .map((e) => `${e.titleEn} ${e.titleBn ?? ""} ${lang === "bn" ? e.answerBn : e.answerEn}`)
    .join(" ");
  const referenceTokens = new Set(tokenizeForSupport(reference));
  const answerTokens = tokenizeForSupport(answer);
  if (answerTokens.length === 0) return null;
  const supported = answerTokens.filter((t) => referenceTokens.has(t)).length;
  return supported / answerTokens.length;
}

/** Outcome of the evidence + support assessment for one hosted answer. */
export interface AnswerAssessment {
  confidence: number;
  lowConfidenceFlag: boolean;
  /** `null` when nothing was retrieved (ungrounded answer). */
  support: number | null;
  /** The answer's citations survive only when its text is supported. */
  supported: boolean;
}

/**
 * F-43: hosted answers are scored from retrieval evidence and an answer-support
 * check. An answer that names or paraphrases the retrieved text keeps its
 * citations; an answer the retrieved text cannot support is downgraded to
 * low-confidence and loses its citations — never the other way round.
 */
export function assessHostedAnswer(answer: string, entries: KbEntry[], scores: number[], lang: AiContext["lang"]): AnswerAssessment {
  if (entries.length === 0) {
    return { confidence: CONFIDENCE_PARAMS.ungrounded, lowConfidenceFlag: true, support: null, supported: false };
  }
  const support = answerSupportRatio(answer, entries, lang);
  const retrieval = retrievalConfidence(entries, scores);
  if (support === null || support < CONFIDENCE_PARAMS.minAnswerSupport) {
    const confidence = Math.min(retrieval, CONFIDENCE_PARAMS.unsupportedAnswer);
    return { confidence: Number(confidence.toFixed(2)), lowConfidenceFlag: confidence < LOW_CONFIDENCE_THRESHOLD, support, supported: false };
  }
  return { confidence: Number(retrieval.toFixed(2)), lowConfidenceFlag: retrieval < LOW_CONFIDENCE_THRESHOLD, support, supported: true };
}
