import type { KbEntry, KbSourceRef } from "./knowledge.js";

export interface AiContext {
  lang: "bn" | "en";
  farmerName?: string;
  cropName?: string;
  cropStage?: string;
  district?: string;
  weatherSummary?: string;
  /**
   * Membership tier of the caller, if known. Read today by the per-tier
   * advisory quota (`modules/aiagent/routes.ts` → `advisoryHourlyLimitForTier`)
   * and recorded in the gateway's usage telemetry; the engines do not branch on
   * it (advice quality must not depend on plan).
   */
  membershipTier?: string;
}

export interface AiAnswer {
  answer: string;
  confidence: number; // 0..1
  provider: string;
  model: string;
  lowConfidenceFlag: boolean;
  groundedRefs: string[];
  /**
   * Resolved citation metadata for `groundedRefs`, in the same order (A3-01).
   * Present on every production engine; resolved against the live corpus so a
   * citation can never point at an entry that no longer exists.
   */
  groundedSources?: KbSourceRef[];
  tokensIn?: number;
  tokensOut?: number;
  /**
   * Content version (sha256[:12]) of the knowledge base that grounded this
   * answer — present for BOTH engines. The offline
   * engine reports the version of the corpus it actually retrieved from.
   */
  kbVersion: string;
  /**
   * Hosted-provider prompt template version. Only set by the OpenAI-compatible
   * adapter; the offline engine omits it — its `model` id ("kb-retrieval-v1")
   * already names the deterministic template that produced the answer.
   */
  promptVersion?: string;
  /**
   * Hosted provider only: the model the provider reports it actually served
   * for this completion (the configured `model` is a mutable alias a provider
   * may resolve/roll). Recorded in the usage ledger so an incident can be
   * attributed to the model that answered, not the alias requested.
   */
  responseModel?: string;
  /**
   * Hosted provider only: the provider's opaque deployment fingerprint for the
   * serving backend. Sanitized (single-line, length-capped) before it is
   * recorded — provider output is untrusted input like any other.
   */
  systemFingerprint?: string;
  /**
   * Hosted provider only: share of the answer's content tokens that appear in
   * the retrieved reference text (0..1). `undefined` when nothing was
   * retrieved. F-43: the hosted path used to report a fixed 0.75 whenever any
   * entry was retrieved; confidence is now derived from retrieval scores plus
   * this support measure, and a low measure downgrades the answer to
   * low-confidence with no citations.
   */
  answerSupport?: number;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  /** Set only by providers whose output depends on a prompt template. */
  readonly promptVersion?: string;
  ask(question: string, ctx: AiContext): Promise<AiAnswer>;
}

/**
 * Typed provider failure taxonomy. The adapter previously
 * threw one generic `Error("AI provider error <status>")`, so 429 vs 5xx vs a
 * blocked/truncated/empty generation were indistinguishable to callers and to
 * the gateway. `retryable` marks the classes the adapter itself retries once.
 */
export type AiProviderErrorCode =
  | "EMPTY_CONTENT" // 2xx with empty/whitespace-only content — never served as an answer
  | "CONTENT_FILTERED" // finish_reason=content_filter — provider blocked the output
  | "TRUNCATED" // finish_reason=length — output cut off mid-answer
  | "RATE_LIMITED" // HTTP 429
  | "UPSTREAM" // other non-2xx / transport failure
  | "TIMEOUT"; // AbortSignal.timeout fired

export class AiProviderError extends Error {
  constructor(
    public readonly code: AiProviderErrorCode,
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export const LOW_CONFIDENCE_THRESHOLD = 0.55;

export function expertVerificationNote(lang: "bn" | "en"): string {
  return lang === "bn"
    ? "\n\n⚠️ এই উত্তরটি নিশ্চিত নয়। কোনো ওষুধ/সার প্রয়োগের আগে উপজেলা কৃষি অফিসার বা AgroBridge কৃষিবিদের সাথে যাচাই করুন।"
    : "\n\n⚠️ This answer has low confidence. Please verify with a DAE agronomist or an AgroBridge expert before applying any treatment.";
}

/**
 * Agrochemical-input guardrail (A4-09).
 *
 * `containsAgrochemGuidance` detects advice that names or doses an agrochemical
 * input (pesticide/fungicide/herbicide/fertiliser/growth regulator, amounts per
 * area or volume). When such an answer comes from a corpus entry that is still
 * `UNSOURCED` (no recorded provenance / agronomist sign-off), the engine appends
 * `unreviewedTreatmentNote` — the "explicitly flagged as unverified" arm of the
 * requirement. On a `REVIEWED` entry the note is not needed and not added.
 *
 * Deliberately matches both languages: bn answers name the same inputs in
 * Bengali script (ইউরিয়া, কীটনাশক, ছত্রাকনাশক …), and a guard that only reads
 * English would miss exactly the farmer-facing text it exists to protect.
 */
const AGROCHEM_RE =
  /\b(urea|fertili[sz]\w*|pesticid\w*|fungicid\w*|herbicid\w*|insecticid\w*|rodenticid\w*|chemical|spray|dose|dosage)\b|(?:[\d০-৯]|এক|দুই|তিন|চার|পাঁচ)\s*(?:kg|kgs|kilogram|grams?|gm|ml|litre|liter|bigha|shotangsho|শতাংশ|বিঘা|কেজি|গ্রাম|মিলি|লিটার)|ইউরিয়া|কীটনাশক|ছত্রাকনাশক|আগাছানাশক|বালাইনাশক|মাত্রা|সার/i;

export function containsAgrochemGuidance(text: string): boolean {
  return AGROCHEM_RE.test(text);
}

/**
 * Whether an answer needs the review-pending note: it names or doses an
 * agrochemical input AND at least one grounding entry is `UNSOURCED` — or
 * nothing was retrieved at all, in which case the text cannot be grounded in
 * any source and the note is the honest floor.
 *
 * F-44: this decision used to be inlined in the offline engine, so the hosted
 * provider — the one path that can invent a dose from parametric memory —
 * never applied it. Both engines now call this single helper.
 */
export function unreviewedTreatmentRequired(answer: string, entries: KbEntry[]): boolean {
  if (!containsAgrochemGuidance(answer)) return false;
  if (entries.length === 0) return true;
  return entries.some((e) => e.status === "UNSOURCED");
}

export function unreviewedTreatmentNote(lang: "bn" | "en"): string {
  return lang === "bn"
    ? "\n\n⚠️ উপরের চিকিৎসা/সার সংক্রান্ত পরামর্শটি অভ্যন্তরীণ তথ্যভাণ্ডার থেকে — এখনো বিশেষজ্ঞ-যাচাইকৃত নয়। সঠিক ওষুধ, মাত্রা ও নিরাপত্তা ব্যবস্থা প্রয়োগের আগে উপজেলা কৃষি অফিসারের সাথে নিশ্চিত করুন।"
    : "\n\n⚠️ The treatment/input guidance above comes from an internal knowledge base that is not yet agronomist-reviewed. Confirm the exact product, dose and safety measures with your local DAE agriculture officer before applying.";
}
