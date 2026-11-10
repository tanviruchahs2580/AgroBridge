import { createHash } from "node:crypto";

export interface KbEntry {
  id: string;
  crop: string; // lowercase crop key or "general"
  keywords: string[]; // lowercase match terms (English + Bengali)
  titleEn: string;
  /** Bengali title shown in the bn UI as the source name. Optional: an entry
   *  without one falls back to its English title rather than a machine
   *  translation. */
  titleBn?: string;
  answerEn: string;
  answerBn: string;
  confidence: number;
  /**
   * Provenance ledger. Every entry must carry explicit
   * source/review metadata so an unsourced entry is visible in code review:
   *   sourceName — human-readable source title, or null when none is recorded
   *   sourceUrl  — public URL, or null
   *   reviewedAt — ISO date an agronomist signed off the content, or null
   *   status     — "UNSOURCED" until provenance + rights are reviewed
   * All entries below are UNSOURCED: no external source, rights basis or
   * agronomist sign-off has been recorded yet. Provenance/rights are pending
   * owner + agronomist review — do NOT invent citations to fill these fields.
   */
  sourceName: string | null;
  sourceUrl: string | null;
  reviewedAt: string | null;
  status: "UNSOURCED" | "REVIEWED";
}

/**
 * Curated, grounded agronomy knowledge base for major Bangladesh crops.
 * This is the retrieval source for the offline AI engine (RAG-lite).
 * Answers are advisory and always recommend field verification for treatments.
 *
 * Keyword-authoring conventions (enforced by `compileRule` + the
 * kb-reproducibility suite):
 *   - a Latin keyword matches ONLY as a whole word at a word boundary;
 *   - a trailing `*` marks the keyword as a stem ("irrigat*" matches
 *     "irrigation"/"irrigate", "brown spot*" matches "brown spots").
 *     Stems are explicit because a short un-starred alias with prefix
 *     matching grounded unrelated English words (F-45: "sec" matched
 *     "secret"/"sector"/"second" and retrieved irrigation advice);
 *   - Bengali terms match as substrings of the normalized query — Bengali is
 *     written with combining marks, so a Latin-style `\b` boundary would split
 *     words at the hasanta; the normalizer collapses the known variants.
 */
export const KNOWLEDGE_BASE: KbEntry[] = [
  {
    id: "rice-blast",
    crop: "rice",
    // "পাতা মোড়ানো" (leaf rolling) was removed: leaf rolling is a leaf-roller
    // symptom, not blast, and the +2.2 phrase hit retrieved the wrong treatment
    // (fungicide + drain the field) for it. No corpus entry covers leaf rollers,
    // so such questions now abstain honestly instead of retrieving blast.
    keywords: ["rice", "ধান", "blast", "ব্লাস্ট", "blight", "ব্লাইট", "fungus*", "fungus on rice", "fungal*", "brown spot*", "দাগ", "ছোপ", "ধূসর", "সিগার"],
    titleEn: "Rice blast / fungal leaf disease management",
    titleBn: "ধানের ব্লাস্ট / ছত্রাকজনিত পাতা-রোগ ব্যবস্থাপনা",
    answerEn:
      "Rice blast appears as spindle-shaped lesions with grey centres on leaves. Management: 1) Keep fields drained rather than continuously flooded when infection appears. 2) Avoid excess nitrogen fertiliser which worsens blast. 3) Use recommended fungicides (e.g., tricyclazole or isoprothiolane group) applied at early lesion stage — confirm product choice with a licensed dealer or DAE agronomist. 4) Remove and burn infected stubble after harvest.",
    answerBn:
      "রাইস ব্লাস্টে পাতায় সিগারের মতো ধূসর কেন্দ্রযুক্ত দাগ দেখা যায়। ব্যবস্থাপনা: ১) আক্রমণ দেখা দিলে জমিতে জমা পানি সরিয়ে শুকনো-ভেজা অবস্থা রাখুন। ২) অতিরিক্ত ইউরিয়া সেচ বন্ধ করুন। ৩) প্রথম দাগ দেখা মাত্রই অনুমোদিত ছত্রাকনাশক (ট্রাইসাইক্লাজল/আইসোপ্রথিওলেন গ্রুপ) স্প্রে করুন — ওষুধ নির্বাচনে কৃষি কর্মকর্তার পরামর্শ নিন। ৪) ফসল কাটার পর আক্রান্ত খড় পুড়িয়ে ফেলুন।",
    confidence: 0.82,
    sourceName: null,
    sourceUrl: null,
    reviewedAt: null,
    status: "UNSOURCED",
  },
  {
    id: "rice-urea",
    crop: "rice",
    keywords: ["rice", "ধান", "urea", "ইউরিয়া", "fertilizer rice", "ধানে সার", "top dress*"],
    titleEn: "Urea application schedule for rice",
    titleBn: "ধানে ইউরিয়া প্রয়োগের সময়সূচি",
    answerEn:
      "For modern high-yielding Boro/Aus rice: apply urea in 3 splits — 50% at 15 days after transplanting (tillering), 30% at panicle initiation (~40 days), 20% just before flowering. Never apply urea on dry soil without standing water. A leaf colour chart (LCC) score of 4 indicates correct nitrogen status.",
    answerBn:
      "আধুনিক উচ্চফলনশীল বোরো/আউশ ধানে ইউরিয়া ৩ কিস্তিতে দিন — রোপণের ১৫ দিন পর ৫০%, প্যানিকল আসার সময় (~৪০ দিন) ৩০%, ফুল আসার ঠিক আগে ২০%। জমিতে পানি না থাকলে ইউরিয়া দেবেন না। লিফ কালার চার্টে ৪ নম্বর রঙ হলে সঠিক মাত্রা।",
    confidence: 0.88,
    sourceName: null,
    sourceUrl: null,
    reviewedAt: null,
    status: "UNSOURCED",
  },
  {
    id: "wheat-rust",
    crop: "wheat",
    keywords: ["wheat", "গম", "rust", "রাস্ট", "মরিচা", "yellow leaves wheat"],
    titleEn: "Wheat rust disease",
    titleBn: "গমের রাস্ট (মরিচা) রোগ",
    answerEn:
      "Yellow/orange powdery pustules on wheat leaves indicate rust. Severity rises with warm humid spells. Action: scout weekly, apply a triazole-group fungicide at first sign if coverage >5% of leaf area (confirm locally registered products), and prefer rust-tolerant varieties (e.g., BARI Gom series noted as tolerant) next season.",
    answerBn:
      "গমের পাতায় হলুদ/কমলা গুঁড়োর মতো দাগ হলে মরিচা রোগ। উষ্ণ-আর্দ্র আবহাওয়ায় বাড়ে। পাতার ৫%-এর বেশি আক্রান্ত হলে ট্রায়াজল গ্রুপের ছত্রাকনাশক স্প্রে করুন (স্থানীয়ভাবে অনুমোদিত ওষুধ নিশ্চিত করুন)। পরের মৌসুমে মরিচা-প্রতিরোধী জাত (বারি গম সিরিজ) বপন করুন।",
    confidence: 0.8,
    sourceName: null,
    sourceUrl: null,
    reviewedAt: null,
    status: "UNSOURCED",
  },
  {
    id: "jute-stem-rot",
    crop: "jute",
    keywords: ["jute", "পাট", "stem rot", "কাণ্ড পচা", "yellowing jute", "কান্ড পচ", "পচে", "পচন", "ড্ড পচ"],
    titleEn: "Jute stem rot & yellowing",
    titleBn: "পাটের কাণ্ড পচা ও হলুদ হয়ে যাওয়া",
    answerEn:
      "Stem rot in jute often follows waterlogging. Ensure drainage, avoid wounding plants during weeding, and apply potash as per soil test since potassium deficiency increases susceptibility. Rotate with rice to break disease cycles.",
    answerBn:
      "পাটে কাণ্ড পচা রোগ সাধারণত জমাত পানির কারণে হয়। জমির নিষ্কাশন নিশ্চিত করুন, আগাছা পরিষ্কারের সময় গাছে আঘাত এড়ান, মাটি পরীক্ষা অনুযায়ী পটাশ দিন এবং ধানের সাথে ফসল পর্যায় করুন।",
    confidence: 0.75,
    sourceName: null,
    sourceUrl: null,
    reviewedAt: null,
    status: "UNSOURCED",
  },
  {
    id: "mustard-aphid",
    crop: "mustard",
    keywords: ["mustard", "সরিষা", "aphid*", "এফিড", "green insects mustard", "সবুজ পোকা", "পোকা জড়ো"],
    titleEn: "Mustard aphid control",
    titleBn: "সরিষার জাবপোকা দমন",
    answerEn:
      "Aphids cluster on flowering shoots causing curling and poor pod set. Spray water jet first for light infestations; if populations are high, use an approved insecticide in late afternoon (protects bees), rotate actives between sprays, and harvest timely. Encourage ladybird beetles — natural predators. Confirm the specific product with a licensed dealer or DAE agronomist before spraying.",
    answerBn:
      "সরিষার মুকুলে এফিড জড়ো হলে পাতা কুঁকড়ে যায়, ফল কমে। হালকা আক্রমণে পানির ঝাপটা দিন; বেশি হলে বিকেলে অনুমোদিত কীটনাশক স্প্রে করুন (মৌমাছি রক্ষার্থে), পরপর স্প্রেতে ওষুধ পরিবর্তন করুন। লেডিবার্ড পোকা প্রাকৃতিক শত্রু — ধ্বংস করবেন না। স্প্রের আগে নির্দিষ্ট ওষুধের নাম অনুমোদিত ডিলার বা কৃষি কর্মকর্তার সাথে নিশ্চিত করুন।",
    confidence: 0.8,
    sourceName: null,
    sourceUrl: null,
    reviewedAt: null,
    status: "UNSOURCED",
  },
  {
    id: "soil-test",
    crop: "general",
    keywords: ["soil test*", "মাটি পরীক্ষা", "soil health", "soil ph"],
    titleEn: "Soil testing guidance",
    titleBn: "মাটি পরীক্ষার নির্দেশিকা",
    answerEn:
      "Test your soil every 2–3 years before the major season. Collect samples from 15 cm depth across 8–10 spots of the plot, mix, and take ~500 g to the nearest SRDI/DAE office. Fertiliser recommendations based on soil test typically save 20–30% fertiliser cost. AgroBridge offers soil testing service booking under Services.",
    answerBn:
      "প্রতি ২–৩ বছর অন্তর মূল মৌসুমের আগে মাটি পরীক্ষা করান। প্লটের ৮–১০ জায়গা থেকে ১৫ সেমি গভীরতায় মাটি নিয়ে মিশিয়ে ~৫০০ গ্রাম নিকটস্থ SRDI/কৃষি অফিসে পাঠান। মাটি পরীক্ষা-ভিত্তিক সার প্রয়োগে ২০–৩০% সাশ্রয় হয়। AgroBridge-এর Services থেকে মাটি পরীক্ষার বুকিং দেওয়া যায়।",
    confidence: 0.9,
    sourceName: null,
    sourceUrl: null,
    reviewedAt: null,
    status: "UNSOURCED",
  },
  {
    id: "irrigation-general",
    crop: "general",
    keywords: [
      "irrigat*", "সেচ", "water schedule", "watering", "পানি দেওয়া",
      "পানি দিন", "পানি দেব", "পানি কখন", "পানি কত", "ড্রিপ",
      // "সিন্চন" (hasanta spelling) was removed as a redundant duplicate:
      // normalizeQuery already collapses it to "সিনচন", so keeping both only
      // doubled the keyword count (the compiler now also de-dupes defensively).
      "পানি", "সেচন", "সিনচন", "সেচে",
    ],
    titleEn: "Irrigation best practice",
    titleBn: "সেচের সর্বোত্তম চর্চা",
    answerEn:
      "Irrigate early morning or evening to cut evaporation losses. For most field crops, alternate wetting and drying beats constant flooding. Watch AgroBridge weather advisories — irrigate before forecast heat waves and skip irrigation within 48h of heavy rain.",
    answerBn:
      "সকালে বা বিকালে সেচ দিন — পানি বাষ্পীভবনে কম নষ্ট হবে। বেশিরভাগ ফসলে জমাত পানি না রেখে ভেজা-শুকনা পর্যায় ভালো। তাপপ্রবাহের আগে সেচ দিন এবং ভারী বৃষ্টির ৪৮ ঘণ্টার মধ্যে সেচ এড়িয়ে চলুন।",
    confidence: 0.85,
    sourceName: null,
    sourceUrl: null,
    reviewedAt: null,
    status: "UNSOURCED",
  },
];

/**
 * Weights and gates of the deterministic retriever, registered in one place so
 * `docs/ai-parameters.md` can name every tunable (the audit found the tier
 * weights and the hosted-confidence constants were unregistered).
 *
 * The crop-context hint is a RANKING TIE-BREAK ONLY: it never counts as
 * topical evidence (the topical gate ignores it) and never reaches the
 * confidence mapping (F-43-adjacent: the same question used to score 0.88 with
 * an active rice cycle and 0.66 without, flipping the UI support band).
 */
export const RETRIEVAL_WEIGHTS = {
  /** A single strong topical keyword hit. */
  strongSingleHit: 1.5,
  /** A multi-word topical phrase hit — the most specific evidence available. */
  strongPhraseHit: 2.2,
  /** A crop-name alias hit; counts at most once per entry (never grounds alone). */
  weakCropAliasHit: 0.5,
  /** Farm-derived crop-cycle hint; ranking tie-break among topical entries only. */
  cropContextHint: 2,
} as const;

/** Number of entries `retrieve` returns (primary answer + tie-break support). */
export const RETRIEVAL_TOP_K = 2;

/**
 * Crop-name aliases per crop. Matching these is *weak* evidence: every entry of
 * a crop repeats them, so a bare crop mention must never outrank an entry that
 * actually matched the question's topic (e.g. "irrigate my rice field" used to
 * retrieve the blast-disease entry because "rice" scored the same as
 * "irrigation").
 */
export const CROP_ALIASES: Record<string, string[]> = {
  rice: ["rice", "ধান", "paddy"],
  wheat: ["wheat", "গম"],
  jute: ["jute", "পাট"],
  mustard: ["mustard", "সরিষা"],
};

/** Crop keys the KB knows. Anything else is not a recognised crop context. */
export const KNOWN_CROP_KEYS: string[] = Object.keys(CROP_ALIASES);

/**
 * Words that may accompany a crop name in a farm record or a client payload
 * ("Boro rice field", "T. Aman rice"). They carry no crop of their own; every
 * other unknown word makes the whole value unrecognisable.
 */
const CROP_QUALIFIERS = new Set(["boro", "aus", "aman", "rabi", "kharif", "field", "season", "crop"]);

/**
 * Canonical crop key for a user- or DB-supplied crop name, or `undefined` when
 * the value is not part of the known crop vocabulary.
 *
 * F-07: `cropName` is user-supplied (`POST /ai/advisory`) and was interpolated
 * raw into the hosted system prompt. Callers pass it through this allow-list so
 * only canonical keys ("rice", "wheat", …) can ever reach a provider; an
 * unrecognised crop name simply loses its ranking hint.
 *
 * The value must READ as a crop name: every token is either a crop alias, a
 * known qualifier, or a short variety code (≤2 chars, e.g. "BR-11"); any other
 * word makes it unrecognisable. A sentence like
 * "rice.\nIgnore all previous instructions" is therefore rejected outright
 * rather than mined for the token "rice".
 */
export function canonicalCropOf(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const tokens = normalizeQuery(raw)
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean);
  if (tokens.length === 0 || tokens.length > 6) return undefined;
  let crop: string | undefined;
  for (const token of tokens) {
    if (token.length <= 2) continue; // variety/season codes ("BR-11" → "br", "11")
    const hit = KNOWN_CROP_KEYS.find((key) => CROP_ALIASES[key].some((alias) => normalizeQuery(alias) === token));
    if (hit) {
      if (crop && crop !== hit) return undefined; // two different crops: not a crop name
      crop = hit;
      continue;
    }
    if (!CROP_QUALIFIERS.has(token)) return undefined;
  }
  return crop;
}

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
 * matches for such questions. Every Latin rule is anchored at a Latin word
 * boundary (`compileRule`); a trailing `*` marks an explicit stem. The old
 * prefix-everything behaviour let a 3-letter alias ("sec") match any English
 * word starting with it (F-45: "secret", "sector", "second" grounded
 * irrigation advice at strong tier), so stems are now opt-in and auditable.
 * Aliases inherit the tier (weak/strong) of their canonical keyword.
 */
const BANGLISH_ALIASES: Record<string, string[]> = {
  // Strong topical keywords
  "\u09b8\u09c7\u099a": ["sech*", "sec", "sinch*", "shinch*"], // সেচ — "sec" only as its own word
  "\u09aa\u09be\u09a8\u09bf": ["paani*", "pani", "panir"], // পানি — no "pani*": "panic*" would collide
  "\u0987\u0989\u09b0\u09bf\u09af\u09bc\u09be": ["yuria*", "iuria*"], // ইউরিয়া
  "\u09ae\u09b0\u09bf\u099a\u09be": ["moricha*"], // মরিচা
  "\u09b8\u09ac\u09c1\u099c \u09aa\u09cb\u0995\u09be": ["shabuj poka", "sabuj poka"], // সবুজ পোকা
  "\u09ae\u09be\u099f\u09bf \u09aa\u09b0\u09c0\u0995\u09b7\u09be": ["mati porikkha*", "matir porikkha*", "mati poriksha*"], // মাটি পরীক্ষা
  // Weak crop aliases (same tier as their canonical form)
  "\u09a7\u09be\u09a8": ["dhan*", "dhaan*"],
  "\u0997\u09ae": ["gom"],
  "\u09aa\u09be\u099f": ["paat"],
  "\u09b8\u09b0\u09bf\u09b7\u09be": ["shorisha*", "sorisha*", "shorish*"],
};

/**
 * Alias lookup keyed by the NORMALIZED canonical keyword. `normalizeQuery`
 * strips the hasanta, so a Bengali keyword authored with or without it must
 * still find its aliases — keying the raw strings (the previous behaviour)
 * silently dropped every alias whose key byte-spelling differed from the
 * normalized keyword.
 */
const BANGLISH_BY_KEY: Record<string, string[]> = Object.fromEntries(
  Object.entries(BANGLISH_ALIASES).map(([key, aliases]) => [normalizeQuery(key), aliases]),
);

interface MatchRule {
  weak: boolean; // crop-name evidence: counts once per entry, never grounds an answer alone
  phrase: boolean; // multi-word keywords are the most specific evidence
  stem: boolean; // explicit prefix match (trailing `*`)
  asciiRe: RegExp | null; // Latin keywords: word-anchored, `/g` for occurrence scanning
  literal: string | null; // non-Latin keywords: substring match on normalized text
}

/**
 * Negation cues, checked around each matched keyword span. Deliberately small,
 * per-language and conservative:
 *   - Bengali places the negator AFTER the verb ("ইউরিয়া দেব না"), so the
 *     postposed window looks up to two words ahead, plus an attached suffix
 *     ("দেবনা");
 *   - English places it before ("will not apply urea"), so the preposed window
 *     looks up to two words back.
 * Banglish negation ("yuria dibo na") uses the same postposed Latin words as
 * Bengali romanized speech ("na"/"nai"/"noy"), which are therefore in the
 * postposed set too.
 * The goal is narrow: a negated mention must not be served as its own
 * counter-advice ("ইউরিয়া দেব না" must not retrieve "apply urea in 3 splits").
 * When every topical mention of every entry is negated the query abstains —
 * the honest outcome for a question the corpus cannot answer.
 *
 * Clause boundaries terminate the window: in "ধান ভালো হচ্ছে না, সেচ কখন দেব?"
 * the "না" negates the crop clause, NOT the irrigation question — a
 * whitespace-only window is why a comma is treated as a hard stop.
 */
const BN_NEGATORS = new Set(["না", "নয়", "নেই", "নাই", "ছাড়া", "বাদ", "বন্ধ", "ব্যতীত", "na", "nai", "noy"]);
const EN_NEGATORS = new Set(["not", "no", "never", "without", "avoid", "don't", "dont", "cannot", "can't", "won't", "nor"]);
// Clause punctuation only. Quotes/apostrophes are deliberately NOT boundaries
// because English negators are contractions ("don't", "can't").
const CLAUSE_BOUNDARY = /[,;:.!?।…()—–]/u;

/** Last clause fragment before the match (clause boundaries terminate it). */
function clauseBefore(text: string, start: number, maxChars = 40): string {
  const window = text.slice(Math.max(0, start - maxChars), start);
  let cut = 0;
  for (const m of window.matchAll(new RegExp(CLAUSE_BOUNDARY.source, "gu"))) cut = (m.index ?? 0) + 1;
  return window.slice(cut);
}

/** First clause fragment after the match (clause boundaries terminate it). */
function clauseAfter(text: string, end: number, maxChars = 40): string {
  const window = text.slice(end, end + maxChars);
  const boundary = window.search(CLAUSE_BOUNDARY);
  return boundary === -1 ? window : window.slice(0, boundary);
}

function words(fragment: string): string[] {
  return fragment.split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
}

/** True when the keyword occurrence at `[start, end)` sits inside a negation. */
export function isNegatedMention(text: string, start: number, end: number): boolean {
  const before = words(clauseBefore(text, start));
  const after = words(clauseAfter(text, end));
  // English preposed negation ("not apply urea", "avoid urea") — within two
  // words in the same clause.
  if (before.slice(-2).some((t) => EN_NEGATORS.has(t))) return true;
  // Bengali postposed negation ("ইউরিয়া দেব না") and attached suffix ("দেবনা").
  if (after.slice(0, 2).some((t) => BN_NEGATORS.has(t))) return true;
  const next = after[0];
  if (next && next.length > 2 && /(না|নয়|নেই)$/.test(next)) return true;
  // Bengali preposed negation immediately before the keyword ("ছাড়া ইউরিয়া").
  const prev = before[before.length - 1];
  return Boolean(prev && BN_NEGATORS.has(prev));
}

function compileRule(canonical: string, weak: boolean): MatchRule {
  const starred = canonical.endsWith("*");
  const base = normalizeQuery(starred ? canonical.slice(0, -1) : canonical).trim();
  const phrase = base.includes(" ");
  if (!/^[\x20-\x7E]+$/.test(base)) {
    return { weak, phrase, stem: false, asciiRe: null, literal: base };
  }
  if (starred && !phrase && base.length < 4) {
    // F-45 authoring guard: a short stem is exactly the "sec" class of defect
    // (it matches every English word starting with it). Fail loudly at import
    // rather than silently degrading retrieval precision.
    throw new Error(`KB keyword stem "*" is too short to be unambiguous: "${canonical}"`);
  }
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  // Word-anchored at the START; the END is a word boundary unless the author
  // declared a stem with `*` — the F-45 fix.
  const tail = starred ? "[a-z0-9]*" : "(?![a-z0-9])";
  return { weak, phrase, stem: starred, asciiRe: new RegExp(`(^|[^a-z0-9])(${esc})${tail}`, "g"), literal: null };
}

/** All non-negated occurrences of one rule, as half-open spans of the query. */
function ruleSpans(text: string, rule: MatchRule): { start: number; end: number; rule: MatchRule }[] {
  const spans: { start: number; end: number; rule: MatchRule }[] = [];
  if (rule.literal !== null) {
    let i = text.indexOf(rule.literal);
    while (i !== -1) {
      if (!isNegatedMention(text, i, i + rule.literal.length)) spans.push({ start: i, end: i + rule.literal.length, rule });
      i = text.indexOf(rule.literal, i + 1);
    }
    return spans;
  }
  const re = rule.asciiRe;
  if (!re) return spans;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index === re.lastIndex) re.lastIndex++; // never loop on a zero-width match
    const start = m.index + (m[1]?.length ?? 0);
    const end = m.index + m[0].length;
    if (!isNegatedMention(text, start, end)) spans.push({ start, end, rule });
  }
  return spans;
}

/**
 * Overlapping spans are ONE piece of evidence, counted once at the longest
 * match. Without this, a query containing "সেচন" scored twice ("সেচ" is a
 * substring of "সেচন") and duplicated normalized keywords ("সিন্চন" normalizes
 * to "সিনচন", already in the list) scored twice again — silent score inflation
 * that made the score→confidence mapping impossible to reason about.
 */
function mergeSpans(spans: { start: number; end: number; rule: MatchRule }[]): { start: number; end: number; rule: MatchRule }[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const out: typeof spans = [];
  for (const s of sorted) {
    if (!out.some((o) => s.start < o.end && o.start < s.end)) out.push(s);
  }
  return out;
}

function compileCorpus(corpus: KbEntry[]): { entry: KbEntry; rules: MatchRule[] }[] {
  return corpus.map((entry) => {
    const aliases = new Set([...(CROP_ALIASES[entry.crop] ?? []), entry.crop].map(normalizeQuery));
    const seen = new Set<string>();
    const rules: MatchRule[] = [];
    for (const kw of entry.keywords) {
      const n = normalizeQuery(kw.trim().replace(/\*$/, ""));
      const weak = aliases.has(n);
      for (const alias of [kw, ...(BANGLISH_BY_KEY[n] ?? [])]) {
        const rule = compileRule(alias, weak);
        // Identical normalized patterns (duplicate keywords, alias == canonical)
        // must not multiply the score.
        const key = `${rule.weak}|${rule.asciiRe?.source ?? rule.literal}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rules.push(rule);
      }
    }
    return { entry, rules };
  });
}

const COMPILED = compileCorpus(KNOWLEDGE_BASE);

/**
 * Strip instruction-like patterns to reduce the prompt-injection surface.
 * Fenced code blocks, chat role prefixes, angle brackets and bracketed
 * instruction markers ([INST]/[SYS]/[SYSTEM] and their closing forms) are
 * removed; the result is trimmed and capped at 1000 chars to bound input.
 */
export function sanitizeQuestion(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, "[code-block removed]")
    .replace(/(system|assistant|developer)\s*[:：]/gi, "")
    .replace(/\[\/?(?:INST|SYS|SYSTEM)\]/gi, "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 1000);
}

/**
 * `corpus` defaults to the built-in KB — production retrieval is unchanged.
 * It exists so evaluation/degradation runs can inject a variant (empty or
 * limited corpus) and prove the eval gate fails when retrieval degrades.
 *
 * Returns the top `RETRIEVAL_TOP_K` entries and their **topical** scores. The
 * farm-context hint (`hintCrop`) only breaks ties in the ranking; it is
 * excluded from the returned scores so a confidence number can never be
 * inflated by farm state (F-43-adjacent).
 */
export function retrieve(questionLower: string, hintCrop?: string, corpus: KbEntry[] = KNOWLEDGE_BASE): { entries: KbEntry[]; scores: number[] } {
  const nq = normalizeQuery(questionLower);
  const hint = canonicalCropOf(hintCrop);
  const compiled = corpus === KNOWLEDGE_BASE ? COMPILED : compileCorpus(corpus);
  const scored = compiled
    .map(({ entry, rules }, index) => {
      const spans = mergeSpans(rules.flatMap((rule) => ruleSpans(nq, rule)));
      let topicalScore = 0;
      let topicalHits = 0;
      let weakMatched = false;
      for (const { rule } of spans) {
        if (rule.weak) {
          if (!weakMatched) {
            topicalScore += RETRIEVAL_WEIGHTS.weakCropAliasHit;
            weakMatched = true;
          }
        } else {
          topicalScore += rule.phrase ? RETRIEVAL_WEIGHTS.strongPhraseHit : RETRIEVAL_WEIGHTS.strongSingleHit;
          topicalHits++;
        }
      }
      // Crop context from farm state is a tie-breaker among entries that already
      // have topical evidence — never grounding on its own, never scored.
      // (Regression: a farmer with an active rice cycle asking about irrigation
      // timing got rice-blast management advice at the entry's full stored
      // confidence, because the hint alone made every rice entry a "strong"
      // match.)
      const hintBonus = hint && entry.crop === hint ? RETRIEVAL_WEIGHTS.cropContextHint : 0;
      return { entry, topicalScore, rankScore: topicalScore + hintBonus, topicalHits, index };
    })
    .filter((s) => s.topicalHits > 0); // topical gate: a bare crop mention never grounds an answer

  // Rank by total evidence (topical hits + crop-context tie-break), then KB
  // authoring order (stable sort) so long-standing ranking is preserved.
  scored.sort((a, b) => b.rankScore - a.rankScore || a.index - b.index);
  const top = scored.slice(0, RETRIEVAL_TOP_K);
  return { entries: top.map((s) => s.entry), scores: top.map((s) => s.topicalScore) };
}

/**
 * Stable serialization of a KB corpus: fixed field order per entry and sorted
 * keywords, so the digest depends on content only — not object/keyword
 * insertion order — while any answer/title/confidence/provenance edit still
 * changes it.
 */
export function kbVersionOf(corpus: KbEntry[]): string {
  const canonical = corpus
    .map((e) =>
      JSON.stringify({
        id: e.id,
        crop: e.crop,
        keywords: [...e.keywords].sort(),
        titleEn: e.titleEn,
        titleBn: e.titleBn ?? null,
        answerEn: e.answerEn,
        answerBn: e.answerBn,
        confidence: e.confidence,
        sourceName: e.sourceName,
        sourceUrl: e.sourceUrl,
        reviewedAt: e.reviewedAt,
        status: e.status,
      }),
    )
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

/**
 * Content-addressed version of the production knowledge base, computed once at
 * module load. Every advisory response carries it as
 * `kbVersion`, so which KB answered a farmer is auditable from the response
 * itself and a silent KB edit becomes visible instead of untraceable.
 */
export const KB_VERSION = kbVersionOf(KNOWLEDGE_BASE);

/** Freeze the corpus (and every entry/keyword array) so no runtime path can
 *  edit the content that `COMPILED`/`KB_VERSION` were derived from. The corpus
 *  is code-authoritative: a mutation would silently desynchronise retrieval
 *  rules and the content hash. */
for (const entry of KNOWLEDGE_BASE) {
  Object.freeze(entry.keywords);
  Object.freeze(entry);
}
Object.freeze(KNOWLEDGE_BASE);

/**
 * Resolved citation metadata for a grounded answer (A3-01). Built from the
 * live entry itself — id, titles, crop, provenance status — so a citation can
 * never name a document that is not in the corpus and never carries a
 * fabricated URL (the shape deliberately has no URL field; an entry's
 * `sourceUrl` is null until provenance is recorded, and citations resolve
 * against the live corpus at read time).
 */
export interface KbSourceRef {
  id: string;
  titleEn: string;
  titleBn?: string;
  crop: string;
  status: KbEntry["status"];
}

export function sourceRefOf(entry: KbEntry): KbSourceRef {
  return {
    id: entry.id,
    titleEn: entry.titleEn,
    ...(entry.titleBn ? { titleBn: entry.titleBn } : {}),
    crop: entry.crop,
    status: entry.status,
  };
}
