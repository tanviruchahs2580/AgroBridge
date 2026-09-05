export interface KbEntry {
  id: string;
  crop: string; // lowercase crop key or "general"
  keywords: string[]; // lowercase match terms (English + Bengali)
  titleEn: string;
  answerEn: string;
  answerBn: string;
  confidence: number;
}

/**
 * Curated, grounded agronomy knowledge base for major Bangladesh crops.
 * This is the retrieval source for the offline AI engine (RAG-lite).
 * Answers are advisory and always recommend field verification for treatments.
 */
export const KNOWLEDGE_BASE: KbEntry[] = [
  {
    id: "rice-blast",
    crop: "rice",
    keywords: ["rice", "ধান", "blast", "blight", "পাতা মোড়ানো", "মড়ানো", "fungus on rice", "brown spot", "দাগ", "সিগার", "ধূসর"],
    titleEn: "Rice blast / fungal leaf disease management",
    answerEn:
      "Rice blast appears as spindle-shaped lesions with grey centres on leaves. Management: 1) Keep fields drained rather than continuously flooded when infection appears. 2) Avoid excess nitrogen fertiliser which worsens blast. 3) Use recommended fungicides (e.g., tricyclazole or isoprothiolane group) applied at early lesion stage — confirm product choice with a licensed dealer or DAE agronomist. 4) Remove and burn infected stubble after harvest.",
    answerBn:
      "রাইস ব্লাস্টে পাতায় সিগারের মতো ধূসর কেন্দ্রযুক্ত দাগ দেখা যায়। ব্যবস্থাপনা: ১) আক্রমণ দেখা দিলে জমিতে জমা পানি সরিয়ে শুকনো-ভেজা অবস্থা রাখুন। ২) অতিরিক্ত ইউরিয়া সেচ বন্ধ করুন। ৩) প্রথম দাগ দেখা মাত্রই অনুমোদিত ছত্রাকনাশক (ট্রাইসাইক্লাজল/আইসোপ্রথিওলেন গ্রুপ) স্প্রে করুন — ওষুধ নির্বাচনে কৃষি কর্মকর্তার পরামর্শ নিন। ৪) ফসল কাটার পর আক্রান্ত খড় পুড়িয়ে ফেলুন।",
    confidence: 0.82,
  },
  {
    id: "rice-urea",
    crop: "rice",
    keywords: ["rice", "ধান", "urea", "ইউরিয়া", "fertilizer rice", "ধানে সার", "top dress"],
    titleEn: "Urea application schedule for rice",
    answerEn:
      "For modern high-yielding Boro/Aus rice: apply urea in 3 splits — 50% at 15 days after transplanting (tillering), 30% at panicle initiation (~40 days), 20% just before flowering. Never apply urea on dry soil without standing water. A leaf colour chart (LCC) score of 4 indicates correct nitrogen status.",
    answerBn:
      "আধুনিক উচ্চফলনশীল বোরো/আউশ ধানে ইউরিয়া ৩ কিস্তিতে দিন — রোপণের ১৫ দিন পর ৫০%, প্যানিকল আসার সময় (~৪০ দিন) ৩০%, ফুল আসার ঠিক আগে ২০%। জমিতে পানি না থাকলে ইউরিয়া দেবেন না। লিফ কালার চার্টে ৪ নম্বর রঙ হলে সঠিক মাত্রা।",
    confidence: 0.88,
  },
  {
    id: "wheat-rust",
    crop: "wheat",
    keywords: ["wheat", "গম", "rust", "মরিচা", "yellow leaves wheat"],
    titleEn: "Wheat rust disease",
    answerEn:
      "Yellow/orange powdery pustules on wheat leaves indicate rust. Severity rises with warm humid spells. Action: scout weekly, apply a triazole-group fungicide at first sign if coverage >5% of leaf area (confirm locally registered products), and prefer rust-tolerant varieties (e.g., BARI Gom series noted as tolerant) next season.",
    answerBn:
      "গমের পাতায় হলুদ/কমলা গুঁড়োর মতো দাগ হলে মরিচা রোগ। উষ্ণ-আর্দ্র আবহাওয়ায় বাড়ে। পাতার ৫%-এর বেশি আক্রান্ত হলে ট্রায়াজল গ্রুপের ছত্রাকনাশক স্প্রে করুন (স্থানীয়ভাবে অনুমোদিত ওষুধ নিশ্চিত করুন)। পরের মৌসুমে মরিচা-প্রতিরোধী জাত (বারি গম সিরিজ) বপন করুন।",
    confidence: 0.8,
  },
  {
    id: "jute-stem-rot",
    crop: "jute",
    keywords: ["jute", "পাট", "stem rot", "কাণ্ড পচা", "yellowing jute", "কান্ড পচ", "পচে", "পচন", "ড্ড পচ"],
    titleEn: "Jute stem rot & yellowing",
    answerEn:
      "Stem rot in jute often follows waterlogging. Ensure drainage, avoid wounding plants during weeding, and apply potash as per soil test since potassium deficiency increases susceptibility. Rotate with rice to break disease cycles.",
    answerBn:
      "পাটে কাণ্ড পচা রোগ সাধারণত জমাত পানির কারণে হয়। জমির নিষ্কাশন নিশ্চিত করুন, আগাছা পরিষ্কারের সময় গাছে আঘাত এড়ান, মাটি পরীক্ষা অনুযায়ী পটাশ দিন এবং ধানের সাথে ফসল পর্যায় করুন।",
    confidence: 0.75,
  },
  {
    id: "mustard-aphid",
    crop: "mustard",
    keywords: ["mustard", "সরিষা", "aphid", "এফিড", "green insects mustard", "সবুজ পোকা", "পোকা জড়ো"],
    titleEn: "Mustard aphid control",
    answerEn:
      "Aphids cluster on flowering shoots causing curling and poor pod set. Spray water jet first for light infestations; if populations are high, use an approved insecticide in late afternoon (protects bees), rotate actives between sprays, and harvest timely. Encourage ladybird beetles — natural predators.",
    answerBn:
      "সরিষার মুকুলে এফিড জড়ো হলে পাতা কুঁকড়ে যায়, ফল কমে। হালকা আক্রমণে পানির ঝাপটা দিন; বেশি হলে বিকেলে অনুমোদিত কীটনাশক স্প্রে করুন (মৌমাছি রক্ষার্থে), পরপর স্প্রেতে ওষুধ পরিবর্তন করুন। লেডিবার্ড পোকা প্রাকৃতিক শত্রু — ধ্বংস করবেন না।",
    confidence: 0.8,
  },
  {
    id: "soil-test",
    crop: "general",
    keywords: ["soil test", "মাটি পরীক্ষা", "soil health", "soil ph"],
    titleEn: "Soil testing guidance",
    answerEn:
      "Test your soil every 2–3 years before the major season. Collect samples from 15 cm depth across 8–10 spots of the plot, mix, and take ~500 g to the nearest SRDI/DAE office. Fertiliser recommendations based on soil test typically save 20–30% fertiliser cost. AgroBridge offers soil testing service booking under Services.",
    answerBn:
      "প্রতি ২–৩ বছর অন্তর মূল মৌসুমের আগে মাটি পরীক্ষা করান। প্লটের ৮–১০ জায়গা থেকে ১৫ সেমি গভীরতায় মাটি নিয়ে মিশিয়ে ~৫০০ গ্রাম নিকটস্থ SRDI/কৃষি অফিসে পাঠান। মাটি পরীক্ষা-ভিত্তিক সার প্রয়োগে ২০–৩০% সাশ্রয় হয়। AgroBridge-এর Services থেকে মাটি পরীক্ষার বুকিং দেওয়া যায়।",
    confidence: 0.9,
  },
  {
    id: "irrigation-general",
    crop: "general",
    keywords: [
      "irrigat", "সেচ", "water schedule", "watering", "পানি দেওয়া",
      "পানি দিন", "পানি দেব", "পানি কখন", "পানি কত", "ড্রিপ",
      "পানি", "সেচন", "সিনচন", "সেচে", "সিন্চন",
    ],
    titleEn: "Irrigation best practice",
    answerEn:
      "Irrigate early morning or evening to cut evaporation losses. For most field crops, alternate wetting and drying beats constant flooding. Watch AgroBridge weather advisories — irrigate before forecast heat waves and skip irrigation within 48h of heavy rain.",
    answerBn:
      "সকালে বা বিকালে সেচ দিন — পানি বাষ্পীভবনে কম নষ্ট হবে। বেশিরভাগ ফসলে জমাত পানি না রেখে ভেজা-শুকনা পর্যায় ভালো। তাপপ্রবাহের আগে সেচ দিন এবং ভারী বৃষ্টির ৪৮ ঘণ্টার মধ্যে সেচ এড়িয়ে চলুন।",
    confidence: 0.85,
  },
];

/** Crop-name aliases per crop. Matching these is *weak* evidence: every entry of
 *  a crop repeats them, so a bare crop mention must never outrank an entry that
 *  actually matched the question's topic (e.g. "irrigate my rice field" used to
 *  retrieve the blast-disease entry because "rice" scored the same as
 *  "irrigation"). */
export const CROP_ALIASES: Record<string, string[]> = {
  rice: ["rice", "ধান"],
  wheat: ["wheat", "গম"],
  jute: ["jute", "পাট"],
  mustard: ["mustard", "সরিষা"],
};

/**
 * Query/keyword normalization used by `retrieve`. Lowercases, collapses the two
 * য় spellings (single codepoint U+09DF vs the য+nuqta sequence this KB was
 * authored with) and strips Bengali joiner marks (hasanta ্, ZWJ) so spelling
 * variants collide: "সিন্চন"→"সিনচন", "কাড্ড"→"কাডড". Match relations that do not
 * cross a joiner are preserved, so it is safe to apply to queries and keywords alike.
 */
export function normalizeQuery(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\u09DF/g, "\u09AF\u09BC")
    .replace(/[\u09CD\u200D]/g, "");
}

/**
 * Banglish (romanized-Bengali) spellings of existing keywords. Farmers type
 * "paani"/"sinchon"/"dhan" in Latin script; the live engine used to return zero
 * matches for such questions. Matching (see `compileRule`) is anchored at Latin
 * word boundaries and prefix-tolerant — "sec" also hits "secane" — which accepts
 * rare false positives (e.g. "second") in exchange for free-typing coverage.
 * Aliases inherit the tier (weak/strong) of their canonical keyword.
 */
const BANGLISH_ALIASES: Record<string, string[]> = {
  // Strong topical keywords
  "\u09b8\u09c7\u099a": ["sec", "sinch", "shinch"],
  "\u09aa\u09be\u09a8\u09bf": ["paani", "pani"],
  "\u0987\u0989\u09b0\u09bf\u09af\u09bc\u09be": ["yuria", "iuria"],
  "\u09ae\u09b0\u09bf\u099a\u09be": ["moricha"],
  "\u09b8\u09ac\u09c1\u099c \u09aa\u09cb\u0995\u09be": ["shabuj poka", "sabuj poka"],
  "\u09ae\u09be\u099f\u09bf \u09aa\u09b0\u09c0\u0995\u09b7\u09be": ["mati porikkha", "matir porikkha", "mati poriksha"],
  // Weak crop aliases (same tier as their canonical form)
  "\u09a7\u09be\u09a8": ["dhan", "dhaan"],
  "\u0997\u09ae": ["gom"],
  "\u09aa\u09be\u099f": ["paat"],
  "\u09b8\u09b0\u09bf\u09b7\u09be": ["shorisha", "sorisha", "shorish"],
};

interface MatchRule {
  weak: boolean; // crop-name evidence: counts once per entry, never grounds an answer alone
  phrase: boolean; // multi-word keywords are the most specific evidence
  asciiRe: RegExp | null; // Latin keywords: word-anchored, prefix-tolerant match
  literal: string | null; // non-Latin keywords: substring match on normalized text
}

function compileRule(canonical: string, weak: boolean): MatchRule {
  const n = normalizeQuery(canonical);
  if (/^[\x20-\x7E]+$/.test(n)) {
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return { weak, phrase: n.includes(" "), asciiRe: new RegExp(`(^|[^a-z0-9])${esc}`), literal: null };
  }
  return { weak, phrase: n.includes(" "), asciiRe: null, literal: n };
}

const COMPILED = KNOWLEDGE_BASE.map((entry) => {
  const aliases = new Set([...(CROP_ALIASES[entry.crop] ?? []), entry.crop].map(normalizeQuery));
  const rules = entry.keywords.flatMap((kw) => {
    const n = normalizeQuery(kw);
    const weak = aliases.has(n);
    return [kw, ...(BANGLISH_ALIASES[n] ?? [])].map((alias) => compileRule(alias, weak));
  });
  return { entry, rules };
});

/** Strip instruction-like patterns to reduce prompt-injection surface (Section 33). */
export function sanitizeQuestion(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, "[code-block removed]")
    .replace(/(system|assistant|developer)\s*[:：]/gi, "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 1000);
}

export function retrieve(questionLower: string, hintCrop?: string): { entries: KbEntry[]; scores: number[] } {
  const nq = normalizeQuery(questionLower);
  const hint = hintCrop ? normalizeQuery(hintCrop) : undefined;
  const scored = COMPILED.map(({ entry, rules }, index) => {
    let score = 0;
    let topical = 0; // topical-keyword evidence — required to ground an answer
    let weakMatched = false; // a crop mention counts at most once per entry
    if (hint && normalizeQuery(entry.crop) === hint) {
      // Crop context from farm state is a tie-breaker among entries that already
      // have topical evidence — never grounding on its own. (Regression: a farmer
      // with an active rice cycle asking about irrigation timing got rice-blast
      // management advice at the entry's full stored confidence, because the hint
      // alone made every rice entry a "strong" match.)
      score += 2;
    }
    for (const rule of rules) {
      const hit = rule.asciiRe ? rule.asciiRe.test(nq) : rule.literal !== null && nq.includes(rule.literal);
      if (!hit) continue;
      if (rule.weak) {
        if (!weakMatched) {
          score += 0.5;
          weakMatched = true;
        }
      } else {
        // Strong: multi-word phrases are the most specific evidence.
        score += rule.phrase ? 2.2 : 1.5;
        topical++;
      }
    }
    return { entry, score, topical, index };
  }).filter((s) => s.topical > 0); // topical gate: a bare crop mention never grounds an answer

  // Rank by total evidence (topical hits + crop-context tie-break), then KB
  // authoring order (stable sort) so long-standing ranking is preserved.
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return {
    entries: scored.slice(0, 2).map((s) => s.entry),
    scores: scored.slice(0, 2).map((s) => s.score),
  };
}
