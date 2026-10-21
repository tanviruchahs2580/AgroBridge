import { retrieve, KbEntry, KB_VERSION, kbVersionOf } from "./knowledge.js";
import { AiContext, AiAnswer, expertVerificationNote, LOW_CONFIDENCE_THRESHOLD, AiProvider } from "./types.js";

/**
 * Deterministic, grounded, offline AI engine.
 * Retrieves from the curated KB; never fabricates beyond retrieved entries;
 * attaches an explicit expert-verification note when confidence is low.
 */
export class OfflineAgroEngine implements AiProvider {
  readonly name = "offline-agro-engine";
  readonly model = "kb-retrieval-v1";

  /**
   * Version of the corpus this instance retrieves from. Production engines use
   * the frozen `KB_VERSION` constant; an evaluation-only corpus override
   * (degradation runs) gets its own content hash so a test answer can never
   * masquerade as grounded in the production KB.
   */
  private readonly kbVersion: string;

  /**
   * `corpus` is an evaluation-only override (degradation runs); production
   * constructs the engine with no arguments and retrieves from the built-in KB.
   */
  constructor(private readonly opts: { corpus?: KbEntry[] } = {}) {
    this.kbVersion = opts.corpus ? kbVersionOf(opts.corpus) : KB_VERSION;
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- async by provider contract (hosted engines await I/O); the offline engine retrieves synchronously.
  async ask(question: string, ctx: AiContext): Promise<AiAnswer> {
    const q = question.toLowerCase();
    const { entries, scores } = retrieve(q, ctx.cropName, this.opts.corpus);

    if (entries.length === 0) {
      const answer =
        (ctx.lang === "bn"
          ? "আপনার প্রশ্নটি নির্দিষ্টভাবে উত্তর দেওয়ার মতো যথেষ্ট তথ্য আমার কাছে নেই। ফসলের নাম, অবস্থা (পাতা/কাণ্ড/শিকড়) এবং লক্ষণ বিস্তারিত লিখুন — অথবা AgroBridge কৃষিবিদের সাথে কথা বলুন।"
          : "I do not have grounded information to answer this confidently. Please mention the crop name, affected part (leaf/stem/root), and symptoms in detail — or consult an AgroBridge agronomist.") +
        expertVerificationNote(ctx.lang);
      return {
        answer,
        confidence: 0.3,
        provider: this.name,
        model: this.model,
        lowConfidenceFlag: true,
        groundedRefs: [],
        kbVersion: this.kbVersion,
      };
    }

    const primary = entries[0];
    const answer = (ctx.lang === "bn" ? primary.answerBn : primary.answerEn) + "\n\n— " + primary.titleEn;

    // Calibrated confidence: an entry's stored confidence is only earned by
    // multi-hit / phrase matches; a single keyword hit lands in "probably right
    // topic" territory. Reporting the stored value verbatim (the old behaviour)
    // advertised off-topic answers at 85% just because one keyword matched.
    const topScore = scores[0] ?? 0;
    const matchQuality = Math.min(1, 0.75 + Math.max(0, topScore - 1.5) * 0.125);
    const confidence = Math.min(0.95, primary.confidence * matchQuality + (entries.length > 1 ? 0.03 : 0));

    let text = answer;
    if (confidence < LOW_CONFIDENCE_THRESHOLD) {
      text += expertVerificationNote(ctx.lang);
    }

    return {
      answer: text,
      confidence: Number(confidence.toFixed(2)),
      provider: this.name,
      model: this.model,
      lowConfidenceFlag: confidence < LOW_CONFIDENCE_THRESHOLD,
      groundedRefs: entries.map((e) => e.id),
      kbVersion: this.kbVersion,
    };
  }
}
