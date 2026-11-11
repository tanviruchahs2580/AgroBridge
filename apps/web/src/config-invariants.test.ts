/**
 * Build/CI config invariants that nothing else gates (F-33, F-42).
 *
 * Both defects were the same shape: a config value that made a gate *vacuous*
 * or *blind* rather than red, so the failure mode was a green run nobody could
 * trust. A unit test is the cheapest place to lock the property — it runs on
 * every commit, whereas the preflight's copy of the Lighthouse check runs only
 * after a build.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, "..");

describe("playwright.config — a reused server cannot be another project's (F-42)", () => {
  it("never reuses an existing dev server unless the caller opted in by env", () => {
    const config = readFileSync(path.join(WEB, "playwright.config.ts"), "utf8");

    // Port 5173 is shared with a sibling project (AGENTS.md §3). With
    // `reuseExistingServer: true`, Playwright finds *something* answering there,
    // skips starting this dev server and drives the other application — a green
    // run against the wrong app. Reuse must be an explicit, per-run decision.
    expect(config).not.toMatch(/reuseExistingServer:\s*true/);
    expect(config).toMatch(/reuseExistingServer:\s*process\.env\.PLAYWRIGHT_REUSE_SERVER === "1"/);
    // The reason reuse-off is safe: the dev server cannot silently bind another
    // port, so an occupied 5173 fails loudly instead of drifting.
    expect(config).toContain("--strictPort");
  });
});

describe("lighthouserc — the performance budget cannot pass by measuring nothing (F-33)", () => {
  it("asserts every numeric budget pessimistically", () => {
    const config = JSON.parse(readFileSync(path.join(WEB, "lighthouserc.json"), "utf8")) as {
      ci?: { assert?: { assertions?: Record<string, unknown> } };
    };
    const assertions = config.ci?.assert?.assertions ?? {};
    const numeric = ["first-contentful-paint", "largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift"];

    // LHCI's default aggregation is "optimistic", which filters out any run that
    // produced no value at all — the recorded NO_LCP collections (2 of 3 runs)
    // therefore passed the LCP/TBT/CLS assertions. @lhci/utils's
    // `getAssertionResult` fails an assertion as soon as one run lacks a finite
    // value *only* when the aggregation is "pessimistic" (`passed: false`,
    // `actual: NaN`); that is why the value is load-bearing rather than cosmetic.
    for (const id of numeric) {
      const entry = assertions[id] as unknown[];
      expect(Array.isArray(entry), `${id} must be asserted`).toBe(true);
      expect((entry[1] as { aggregationMethod?: string }).aggregationMethod, `${id} must assert pessimistically`).toBe("pessimistic");
    }
  });
});
