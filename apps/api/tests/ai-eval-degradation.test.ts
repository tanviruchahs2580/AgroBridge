import { describe, expect, it } from "vitest";
import { KNOWLEDGE_BASE } from "../src/providers/ai/knowledge.js";
import { OfflineAgroEngine } from "../src/providers/ai/offline-engine.js";
import { AI_EVAL_THRESHOLDS, renderMarkdown, runEvaluation } from "./ai-eval-metrics.js";

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
 * thresholds are breached for each degradation.
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
});
