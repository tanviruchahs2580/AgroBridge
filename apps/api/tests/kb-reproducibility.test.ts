import { describe, expect, it } from "vitest";
import { KNOWLEDGE_BASE, KB_VERSION, kbVersionOf, normalizeQuery, type KbEntry } from "../src/providers/ai/knowledge.js";
import { FENCE_END, FENCE_START } from "../src/providers/ai/prompt.js";

/**
 * A2-05 — the knowledge base is a source file, so "rebuild" is "recompute the
 * canonical manifest from the corpus". This suite pins that the derivation is
 * reproducible and idempotent:
 *
 *  - two independent recomputations produce the same digest (idempotent);
 *  - keyword insertion order and object key order do not change the digest
 *    (the canonical form sorts keywords and fixes field order);
 *  - ANY content change — answer text, provenance field, confidence — does
 *    change the digest (the version cannot go stale silently);
 *  - every entry carries the full provenance ledger, so a corpus entry that
 *    skipped the provenance fields fails here rather than shipping.
 *
 * Extended 2026-11-10 (audit P3 in the AI scope):
 *  - a `REVIEWED` entry must carry a real `sourceName`, `sourceUrl` and an
 *    ISO `reviewedAt` — the previous check only required `reviewedAt`;
 *  - no corpus text may contain the prompt fence tokens;
 *  - the corpus is frozen at load (a runtime mutation would desync the
 *    compiled retrieval rules and the content hash);
 *  - normalized keywords are unique per entry and every `*` stem is long
 *    enough to be unambiguous (the F-45 authoring rule).
 */
describe("knowledge base — reproducible, idempotent manifest (A2-05)", () => {
  it("recomputing twice yields the identical version, and it matches the exported KB_VERSION", () => {
    const first = kbVersionOf(KNOWLEDGE_BASE);
    const second = kbVersionOf(KNOWLEDGE_BASE);
    expect(first).toBe(second);
    expect(first).toBe(KB_VERSION);
    expect(first).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is canonical: keyword order, entry-field key order and a deep clone do not change the digest", () => {
    const reordered: KbEntry[] = KNOWLEDGE_BASE.map((e) => ({
      ...e,
      keywords: [...e.keywords].reverse(),
    }));
    expect(kbVersionOf(reordered)).toBe(KB_VERSION);

    // A JSON round-trip rebuilds every object with the same key set in the same
    // order — the closest thing to "rebuild from a manifest" this corpus has.
    const rebuilt = JSON.parse(JSON.stringify(KNOWLEDGE_BASE)) as KbEntry[];
    expect(kbVersionOf(rebuilt)).toBe(KB_VERSION);
  });

  it("any content edit changes the version — answers, confidence and provenance included", () => {
    const edit = (mutate: (e: KbEntry) => KbEntry): string =>
      kbVersionOf(KNOWLEDGE_BASE.map((e, i) => (i === 0 ? mutate({ ...e }) : e)));

    expect(edit((e) => ({ ...e, answerEn: e.answerEn + " " }))).not.toBe(KB_VERSION);
    expect(edit((e) => ({ ...e, answerBn: e.answerBn + "।" }))).not.toBe(KB_VERSION);
    expect(edit((e) => ({ ...e, confidence: e.confidence + 0.01 }))).not.toBe(KB_VERSION);
    expect(edit((e) => ({ ...e, titleBn: `${e.titleBn ?? e.titleEn} (সংশোধিত)` }))).not.toBe(KB_VERSION);
    expect(edit((e) => ({ ...e, keywords: [...e.keywords, "extra"] }))).not.toBe(KB_VERSION);
    // Provenance is content too: recording a source must move the version, so a
    // reviewed KB can never masquerade as an unreviewed one (or vice versa).
    expect(edit((e) => ({ ...e, status: "REVIEWED" as const, sourceName: "Fixture source" }))).not.toBe(KB_VERSION);
  });

  it("every entry carries the full provenance ledger and a Bengali title", () => {
    const ids = KNOWLEDGE_BASE.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
    expect(KNOWLEDGE_BASE.length).toBeGreaterThanOrEqual(7);
    for (const e of KNOWLEDGE_BASE) {
      for (const key of ["sourceName", "sourceUrl", "reviewedAt", "status"] as const) {
        expect(e, `${e.id} is missing ${key}`).toHaveProperty(key);
      }
      // `null` is allowed (nothing recorded); absence is not.
      expect(["UNSOURCED", "REVIEWED"]).toContain(e.status);
      expect(e.titleBn?.trim(), `${e.id} has no Bengali title`).toBeTruthy();
      if (e.status === "REVIEWED") {
        // A reviewed entry must be reviewable: a real source, a real locator and
        // an ISO review date. The previous check enforced only `reviewedAt`, so a
        // "REVIEWED" entry with invented/absent provenance passed this suite.
        expect(e.sourceName?.trim(), `${e.id} is REVIEWED but has no sourceName`).toBeTruthy();
        expect(e.sourceUrl?.trim(), `${e.id} is REVIEWED but has no sourceUrl`).toBeTruthy();
        expect(e.reviewedAt, `${e.id} is REVIEWED but has no reviewedAt`).not.toBeNull();
        expect(Number.isNaN(new Date(String(e.reviewedAt)).getTime()), `${e.id} reviewedAt is not a date`).toBe(false);
      } else {
        // The honest UNSOURCED default: no partially-filled ledger that could be
        // mistaken for recorded provenance.
        expect(`${e.id}:${e.sourceName ?? ""}${e.sourceUrl ?? ""}${e.reviewedAt ?? ""}`).toBe(`${e.id}:`);
      }
    }
  });

  it("carries no prompt fence tokens anywhere (a corpus edit cannot break the reference block)", () => {
    for (const e of KNOWLEDGE_BASE) {
      const text = [e.id, e.titleEn, e.titleBn ?? "", e.answerEn, e.answerBn, ...e.keywords].join("\n");
      expect(text, e.id).not.toContain(FENCE_START);
      expect(text, e.id).not.toContain(FENCE_END);
    }
  });

  it("is frozen at load — a runtime mutation cannot desync the compiled rules from the hash", () => {
    expect(Object.isFrozen(KNOWLEDGE_BASE)).toBe(true);
    for (const e of KNOWLEDGE_BASE) {
      expect(Object.isFrozen(e), `${e.id} entry`).toBe(true);
      expect(Object.isFrozen(e.keywords), `${e.id} keywords`).toBe(true);
    }
  });

  it("keywords are unique after normalization and every `*` stem is unambiguous", () => {
    for (const e of KNOWLEDGE_BASE) {
      const normalized = e.keywords.map((k) => normalizeQuery(k.trim().replace(/\*$/, "")));
      expect(new Set(normalized).size, `${e.id} has duplicate normalized keywords`).toBe(normalized.length);
      for (const kw of e.keywords) {
        if (!kw.endsWith("*")) continue;
        const base = normalizeQuery(kw.slice(0, -1)).trim();
        // F-45: a short stem is the "sec" class of defect — it matches every
        // English word starting with it. Multi-word stems are specific enough.
        if (!base.includes(" ")) {
          expect(base.length, `stem "${kw}" is too short to be unambiguous`).toBeGreaterThanOrEqual(4);
        }
      }
    }
  });
});
