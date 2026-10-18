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
  tokensIn?: number;
  tokensOut?: number;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  ask(question: string, ctx: AiContext): Promise<AiAnswer>;
}

/**
 * Typed provider failure taxonomy (AUD-107 / A4-03). The adapter previously
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
