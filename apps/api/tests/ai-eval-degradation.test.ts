import { describe, expect, it } from "vitest";
import { KNOWLEDGE_BASE } from "../src/providers/ai/knowledge.js";
import { OfflineAgroEngine } from "../src/providers/ai/offline-engine.js";
import { AI_EVAL_STRATUM_THRESHOLDS, AI_EVAL_THRESHOLDS, renderMarkdown, runEvaluation } from "./ai-eval-metrics.js";

/**
 * DEGRADATION PROOF (A8-01 / AUD-110): the evaluation gate must be able to
 * FAIL.
 *
 * Each run declares the corpus the engine was built with (`opts.corpus`) so the
 * citation-validity and provenance metrics judge the engine against the corpus
 * it claims to retrieve from — a corpus override can never be scored against
 * the production KB by accident. `retrieve()` and the offline engine accept an optional corpus override
 * (production defaults to the built-in KB, so runtime behaviour is unchanged);
 * here the exact same evaluation runs against deliberately broken retrievers.
 *
 * If the gate stayed green under an empty or single-entry corpus, it would be
 * measuring nothing — these tests assert at least two pre-registered
 * thresholds are breached for each degradation. The third case strips one
 * language's keywords only: it exists to prove the PER-STRATUM gate can fail
 * independently of the aggregate, which is the whole point of gating per
 * language (an improvement in en must not hide a bn collapse).
 */
describe("AI evaluation gate fails under deliberate retrieval degradation", () => {
  it("empty corpus breaches at least two pre-registered thresholds", async () => {
    const report = await runEvaluation(new OfflineAgroEngine({ corpus: [] }), AI_EVAL_THRESHOLDS, { corpus: [] });
    console.log("\n" + renderMarkdown(report, "DEGRADED — empty corpus"));
    expect(report.passed).toBe(false);
    expect(report.breaches.length).toBeGreaterThanOrEqual(2);
    // The important ones: retrieval and grounded-answer containment collapse.
    expect(report.metrics.hitRate).toBeLessThan(AI_EVAL_THRESHOLDS.hitRate);
    expect(report.metrics.containment).toBeLessThan(AI_EVAL_THRESHOLDS.containment);
  });

  it("single-entry corpus (only wheat-rust) breaches at least two pre-registered thresholds", async () => {
    const single = KNOWLEDGE_BASE.filter((e) => e.id === "wheat-rust");
    const report = await runEvaluation(new OfflineAgroEngine({ corpus: single }), AI_EVAL_THRESHOLDS, { corpus: single });
    console.log("\n" + renderMarkdown(report, "DEGRADED — single-entry corpus (wheat-rust only)"));
    expect(report.passed).toBe(false);
    expect(report.breaches.length).toBeGreaterThanOrEqual(2);
  });

  it("a Bengali-keyword collapse breaches the bn stratum gate through the aggregate", async () => {
    // Every Bengali keyword removed, Latin keywords intact: bn and banglish
    // questions lose their grounding while the English stratum still passes.
    // This is the case an aggregate-only gate can under-report, so the breach
    // must name the stratum.
    const bnStripped = KNOWLEDGE_BASE.map((e) => ({
      ...e,
      keywords: e.keywords.filter((k) => !/[\u0980-\u09FF]/.test(k)),
    }));
    const report = await runEvaluation(new OfflineAgroEngine({ corpus: bnStripped }), AI_EVAL_THRESHOLDS, { corpus: bnStripped });
    console.log("\n" + renderMarkdown(report, "DEGRADED — Bengali keywords stripped"));

    expect(report.passed).toBe(false);
    const bn = report.stratumMetrics.find((s) => s.key === "lang:bn");
    if (!bn) throw new Error("bn stratum must be reported");
    const bnFloors = AI_EVAL_STRATUM_THRESHOLDS["lang:bn"];
    if (!bnFloors || bnFloors.hitRate === undefined || bnFloors.containment === undefined) {
      throw new Error("the bn stratum floors must be pre-registered");
    }
    if (bn.metrics.hitRate === undefined || bn.metrics.containment === undefined) {
      throw new Error("the bn stratum must report hitRate and containment");
    }
    expect(bn.metrics.hitRate).toBeLessThan(bnFloors.hitRate);
    expect(bn.metrics.containment).toBeLessThan(bnFloors.containment);
    expect(report.breaches.some((b) => b.startsWith("stratum[lang:bn]"))).toBe(true);

    // Meanwhile the English stratum is not the cause — a per-stratum gate is
    // only meaningful if it attributes the failure to the right language.
    const en = report.stratumMetrics.find((s) => s.key === "lang:en");
    if (!en || en.metrics.hitRate === undefined) throw new Error("the en stratum must report a hitRate");
    expect(en.metrics.hitRate).toBe(1);
  });
});
