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
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  ask(question: string, ctx: AiContext): Promise<AiAnswer>;
}

export const LOW_CONFIDENCE_THRESHOLD = 0.55;

export function expertVerificationNote(lang: "bn" | "en"): string {
  return lang === "bn"
    ? "\n\n⚠️ এই উত্তরটি নিশ্চিত নয়। কোনো ওষুধ/সার প্রয়োগের আগে উপজেলা কৃষি অফিসার বা AgroBridge কৃষিবিদের সাথে যাচাই করুন।"
    : "\n\n⚠️ This answer has low confidence. Please verify with a DAE agronomist or an AgroBridge expert before applying any treatment.";
}
