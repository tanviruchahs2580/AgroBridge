import { describe, expect, it } from "vitest";
import { assertKbReviewProvenance, KNOWLEDGE_BASE, type KbEntry } from "../src/providers/ai/knowledge.js";

/**
 * WP-11 / AIG-01: every KB entry is UNSOURCED until an agronomist signs off
 * with real provenance (owner decision 2026-11-22 keeps serve-with-warning in
 * the meantime — docs/remediation-plan-2026-11.md §2). This guard pins the
 * one thing that must never happen: an entry claiming `REVIEWED` without a
 * real sourceName, a public sourceUrl and a parseable reviewedAt. R9: never
 * invent citations to fill the fields — the process is
 * docs/ai/kb-review-process.md.
 */
function entryWith(overrides: Partial<KbEntry>): KbEntry {
  return {
    id: "synthetic",
    crop: "rice",
    keywords: [],
    keywordsBn: [],
    answerEn: "synthetic",
    answerBn: "সিনথেটিক",
    confidence: 0.5,
    sourceName: null,
    sourceUrl: null,
    reviewedAt: null,
    status: "UNSOURCED",
    ...overrides,
  };
}

describe("KB review promotion guard", () => {
  it("the shipped knowledge base passes (every entry is UNSOURCED with null provenance)", () => {
    expect(() => assertKbReviewProvenance(KNOWLEDGE_BASE)).not.toThrow();
    const reviewed = KNOWLEDGE_BASE.filter((e) => e.status === "REVIEWED");
    for (const e of reviewed) {
      expect(e.sourceName).toBeTruthy();
      expect(e.sourceUrl).toMatch(/^https?:\/\//);
      expect(Number.isNaN(Date.parse(e.reviewedAt!))).toBe(false);
    }
  });

  it("refuses a REVIEWED claim missing all three provenance fields", () => {
    expect(() => assertKbReviewProvenance([entryWith({ status: "REVIEWED" })])).toThrow(/synthetic.*sourceName, sourceUrl, reviewedAt/s);
  });

  it("refuses a REVIEWED claim with a name but no public URL and no date", () => {
    expect(() =>
      assertKbReviewProvenance([entryWith({ status: "REVIEWED", sourceName: "DAE handbook" })])
    ).toThrow(/sourceUrl, reviewedAt/s);
  });

  it("refuses a non-URL sourceUrl and an unparseable reviewedAt", () => {
    expect(() =>
      assertKbReviewProvenance([
        entryWith({ status: "REVIEWED", sourceName: "DAE handbook", sourceUrl: "definitely not a url", reviewedAt: "soon" }),
      ])
    ).toThrow(/sourceUrl, reviewedAt/s);
  });

  it("accepts a fully provenanced REVIEWED entry", () => {
    expect(() =>
      assertKbReviewProvenance([
        entryWith({
          status: "REVIEWED",
          sourceName: "DAE handbook",
          sourceUrl: "https://example.gov.bd/handbook",
          reviewedAt: "2026-12-01",
        }),
      ])
    ).not.toThrow();
  });
});
