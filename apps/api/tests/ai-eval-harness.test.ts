import { describe, expect, it } from "vitest";
import { OfflineAgroEngine } from "../src/providers/ai/offline-engine.js";
import {
  AI_EVAL_THRESHOLDS,
  loadDataset,
  renderMarkdown,
  runEvaluation,
  writeArtifact,
} from "./ai-eval-metrics.js";

/**
 * FROZEN AI EVALUATION GATE (AUD-110 / A8-01..A8-08).
 *
 * PRE-REGISTRATION (A8-07): the primary metrics and their acceptance
 * thresholds are fixed in `ai-eval-metrics.ts` — `AI_EVAL_THRESHOLDS`,
 * documented there with rationale — BEFORE any measurement. The gate fails if
 * any pre-registered metric is below its floor, so grounding regressions turn
 * the suite red instead of quietly degrading answers.
 *
 * The held-out set is `tests/fixtures/ai-eval/questions.json` (>=100 synthetic
 * items, stratified by KB crop/topic x bn/banglish/en x grounded/abstain/
 * clarify + safety-critical). It was authored from the current `knowledge.ts`
 * revision; no agronomic facts were invented. `synthetic: true` and
 * `reviewedBy: null` flag every item as unreviewed by an agronomist — this is
 * a smoke gate, not a substitute for SME sign-off.
 *
 * The deterministic OFFLINE engine is driven directly; no external provider is
 * ever called (offline is also the default in tests/setup-env.ts).
 *
 * Machine-readable results: apps/api/eval-artifacts/ai-eval-latest.json — a
 * gitignored build output recomputed on every run; the frozen dataset and the
 * pre-registered thresholds it is measured against ARE committed. A Markdown
 * summary is printed to stdout on every run.
 */
describe("AI evaluation gate — frozen held-out set (offline engine)", () => {
  it("runs the pre-registered gate, prints metrics, and writes the artifact", async () => {
    const { dataset, sha256 } = loadDataset();

    // Dataset integrity: size, synthetic flagging and stratification minima.
    expect(dataset.items.length).toBeGreaterThanOrEqual(100);
    expect(dataset.items.every((i) => i.synthetic === true && i.reviewedBy === null)).toBe(true);
    expect(new Set(dataset.items.map((i) => i.lang))).toEqual(new Set(["bn", "banglish", "en"]));
    for (const kind of ["grounded", "abstain", "clarify"] as const) {
      expect(dataset.items.filter((i) => i.kind === kind).length).toBeGreaterThanOrEqual(5);
    }
    expect(dataset.items.filter((i) => i.kind === "grounded").every((i) => (i.expectRefIds?.length ?? 0) > 0 && (i.expectAnyOf?.length ?? 0) > 0)).toBe(true);
    expect(dataset.items.filter((i) => i.safetyCritical).length).toBeGreaterThanOrEqual(10);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);

    const report = await runEvaluation(new OfflineAgroEngine(), AI_EVAL_THRESHOLDS);
    const artifact = writeArtifact(report, "ai-eval-latest.json");

    // Printed for humans and for the evidence file; the numbers below are the
    // measured baseline, not aspirations.
    console.log("\n" + renderMarkdown(report, "offline-agro-engine (kb-retrieval-v1)"));
    console.log(`artifact written: ${artifact}`);

    expect(report.breaches, `pre-registered gate breached:\n${report.breaches.join("\n")}`).toEqual([]);
    expect(report.passed).toBe(true);
  });
});
