import type { KbSourceRef } from "./knowledge.js";

export interface AiContext {
  lang: "bn" | "en";
  farmerName?: string;
  cropName?: string;
  cropStage?: string;
  district?: string;
  weatherSummary?: string;
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

export function unreviewedTreatmentNote(lang: "bn" | "en"): string {
  return lang === "bn"
    ? "\n\n⚠️ উপরের চিকিৎসা/সার সংক্রান্ত পরামর্শটি অভ্যন্তরীণ তথ্যভাণ্ডার থেকে — এখনো বিশেষজ্ঞ-যাচাইকৃত নয়। সঠিক ওষুধ, মাত্রা ও নিরাপত্তা ব্যবস্থা প্রয়োগের আগে উপজেলা কৃষি অফিসারের সাথে নিশ্চিত করুন।"
    : "\n\n⚠️ The treatment/input guidance above comes from an internal knowledge base that is not yet agronomist-reviewed. Confirm the exact product, dose and safety measures with your local DAE agriculture officer before applying.";
}
