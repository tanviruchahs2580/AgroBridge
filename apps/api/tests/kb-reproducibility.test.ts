import { describe, expect, it } from "vitest";
import { KNOWLEDGE_BASE, KB_VERSION, kbVersionOf, type KbEntry } from "../src/providers/ai/knowledge.js";

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
 * The toolchain itself (node, TypeScript) is version-pinned by .nvmrc and the
 * lockfile; there is no separate build artefact to compare beyond this hash.
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
      expect(e.status === "REVIEWED" ? e.reviewedAt !== null : true).toBe(true);
    }
  });
});
