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
    keywords: ["rice", "ধান", "blast", "blight", "পাতা মোড়ানো", "মড়ানো", "fungus on rice", "brown spot"],
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
    keywords: ["jute", "পাট", "stem rot", "কাণ্ড পচা", "yellowing jute"],
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
    keywords: ["mustard", "সরিষা", "aphid", "এফিড", "green insects mustard"],
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
    keywords: ["soil test", "মাটি পরীক্ষা", "soil health", "ph"],
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
    keywords: ["irrigation", "সেচ", "water schedule", "পানি দেওয়া"],
    titleEn: "Irrigation best practice",
    answerEn:
      "Irrigate early morning or evening to cut evaporation losses. For most field crops, alternate wetting and drying beats constant flooding. Watch AgroBridge weather advisories — irrigate before forecast heat waves and skip irrigation within 48h of heavy rain.",
    answerBn:
      "সকালে বা বিকেলে সেচ দিন — পানি বাষ্পীভবনে কম নষ্ট হবে। বেশিরভাগ ফসলে জমাত পানি না রেখে ভেজা-শুকনা পর্যায় ভালো। তাপপ্রবাহের আগে সেচ দিন এবং ভারী বৃষ্টির ৪৮ ঘণ্টার মধ্যে সেচ এড়িয়ে চলুন।",
    confidence: 0.85,
  },
];

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
  const scored = KNOWLEDGE_BASE.map((entry) => {
    let score = 0;
    if (hintCrop && entry.crop === hintCrop.toLowerCase()) score += 2;
    for (const kw of entry.keywords) {
      if (questionLower.includes(kw)) score += entry.crop === "general" ? 1 : 1.5;
    }
    return { entry, score };
  }).filter((s) => s.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return {
    entries: scored.slice(0, 2).map((s) => s.entry),
    scores: scored.slice(0, 2).map((s) => s.score),
  };
}
