import { describe, expect, it } from "vitest";
import { retrieve } from "../src/providers/ai/knowledge.js";
import { OfflineAgroEngine } from "../src/providers/ai/offline-engine.js";

/**
 * AUD-142 — found by the live acceptance run against production on 2026-10-29.
 *
 * The corpus carried the Latin disease names ("blast", "rust") but not the
 * Bangla transliterations Bangla speakers actually type ("ব্লাস্ট", "রাস্ট").
 * A natural Bangla question therefore matched only the weak "ধান" crop alias,
 * failed the topical gate, and was refused — while the same question typed in
 * English was answered with the rice-blast entry. The explainable half of the
 * fix is the two keywords; this suite is the other half.
 *
 * The exact question below is the one asked in the browser against production.
 */
const engine = new OfflineAgroEngine();

describe("AUD-142: Bangla disease-name transliterations retrieve their entries", () => {
  it("'ধানের পাতায় ব্লাস্ট রোগ দেখা দিয়েছে, কী করব?' grounds on rice-blast (was a refusal)", async () => {
    const res = await engine.ask("ধানের পাতায় ব্লাস্ট রোগ দেখা দিয়েছে, কী করব?", { lang: "bn", cropName: "rice" });
    expect(res.groundedRefs).toContain("rice-blast");
    expect(res.lowConfidenceFlag).toBe(false);
    // The answer is the grounded one, not the insufficient-information refusal.
    expect(res.answer).not.toMatch(/যথেষ্ট তথ্য আমার কাছে নেই/);
    expect(res.answer).toMatch(/ব্লাস্ট/);
  });

  it("the Latin spelling still retrieves the same entry (no regression)", async () => {
    const res = await engine.ask("blast disease in rice leaves, what should I do?", { lang: "en", cropName: "rice" });
    expect(res.groundedRefs).toContain("rice-blast");
  });

  it("'গমে রাস্ট রোগ' grounds on wheat-rust (transliteration added)", async () => {
    const res = await engine.ask("গমে রাস্ট রোগ দেখা দিয়েছে", { lang: "bn", cropName: "wheat" });
    expect(res.groundedRefs).toContain("wheat-rust");
  });

  it("the transliteration does not steal queries from other entries", () => {
    // An irrigation-timing question must still resolve to irrigation, not blast:
    // the blast answer (drain the field, stop urea, spray fungicide) is harmful
    // advice for it. Same guarantee the v1.3.6 regression suite pins.
    const r = retrieve("রোপণের কত দিন পর থেকে ধানে সেচন শুরু করা উচিত?", "rice");
    expect(r.entries[0]?.id).toBe("irrigation-general");
  });

  it("a bare transliterated disease word with no crop still grounds (topical, not crop-dependent)", () => {
    const r = retrieve("ব্লাস্ট");
    expect(r.entries[0]?.id).toBe("rice-blast");
  });
});
