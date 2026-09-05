import { describe, expect, it } from "vitest";
import { retrieve, normalizeQuery } from "../src/providers/ai/knowledge.js";
import { OfflineAgroEngine } from "../src/providers/ai/offline-engine.js";

/**
 * Regression suite for the retrieval defects found in the v1.3.6 hands-on
 * review, exercised directly against the pure retrieval path (no HTTP) so the
 * farm-derived crop hint — the trigger in production — can be covered:
 *
 * 1. An irrigation-timing question in Bengali with common spelling variants
 *    was answered with rice-blast FUNGCIDE advice at "85% · Grounded", because
 *    the only evidence was the weak "ধান" alias + the farmer's active-rice hint.
 * 2. The same question typed Banglish returned zero matches (refusal) even
 *    though the topic is fully covered by the KB.
 */
const engine = new OfflineAgroEngine();

describe("AI retrieval regression — v1.3.6 live-review failures", () => {
  it("bn irrigation-timing query with the farm's rice hint grounds on irrigation, not blast", async () => {
    // The exact shape observed live: post-transplant irrigation timing, while
    // aiagent/routes.ts derives cropName="rice" from the active crop cycle.
    const variants = [
      "রোপণের কত দিন পর থেকে ধানে সেচন শুরু করা উচিত?",
      "রোপণের কত দিন পর থেকে ধানে সিন্চন শুরু করা উচিত?", // hasanta spelling variant
      "ropner por kokhon theke dhan e paani sinchan korbo", // same question, Banglish
    ];
    for (const q of variants) {
      const res = await engine.ask(q, { lang: "bn", cropName: "rice" });
      expect(res.groundedRefs[0], q).toBe("irrigation-general");
      expect(res.lowConfidenceFlag, q).toBe(false);
      // The blast answer (drain the field / stop urea / spray fungicide) is
      // actively harmful for an irrigation-timing question — must not be served.
      expect(res.answer, q).not.toMatch(/ব্ল্যাস্ট|ব্লাস্ট|ছত্রাকন|fungicid/i);
    }
  });

  it("bare crop mention never grounds an answer, even with the crop hint", async () => {
    const res = await engine.ask("আমার ধান কেমন যাবে?", { lang: "bn", cropName: "rice" });
    expect(res.groundedRefs).toHaveLength(0);
    expect(res.lowConfidenceFlag).toBe(true);
    expect(res.confidence).toBeLessThan(0.55);
  });

  it("Banglish queries now retrieve (were silent refusals before the fix)", () => {
    const r = retrieve("secane jome paani rekhe dhan ropon er por kikhon abar sinchon korar uchit?");
    expect(r.entries[0].id).toBe("irrigation-general");
    const r2 = retrieve("amr gom er patay moricha rog dekhechi ki korbo");
    expect(r2.entries[0].id).toBe("wheat-rust");
  });

  it("reported confidence reflects match strength, not just the KB entry value", async () => {
    // Single keyword hit ("irrigat") on an entry whose stored confidence is 0.85:
    // the answer is on-topic but must be presented as less than the stored max.
    const single = await engine.ask("When should I irrigate my rice field?", { lang: "en" });
    expect(single.groundedRefs[0]).toBe("irrigation-general");
    expect(single.confidence).toBeLessThan(0.85);
    expect(single.confidence).toBeGreaterThanOrEqual(0.55);
    expect(single.lowConfidenceFlag).toBe(false);
    // Multi-hit phrase match must report strictly more confidence than the single hit.
    const multi = await engine.ask(
      "what is the watering schedule, how much water and when to irrigate",
      { lang: "en" }
    );
    expect(multi.groundedRefs[0]).toBe("irrigation-general");
    expect(multi.confidence).toBeGreaterThan(single.confidence);
  });

  it("normalizeQuery collapses joiner-mark spelling variants", () => {
    expect(normalizeQuery("সিন্চন")).toBe(normalizeQuery("সিনচন"));
    expect(normalizeQuery("কাড্ড")).toBe(normalizeQuery("কাডড"));
  });
});
