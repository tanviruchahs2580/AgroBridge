import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * F-13: the documented duplication gate (`npm run qa:jscpd`) used to scan the
 * whole repository while CI ran `npx jscpd apps/api/src apps/web/src` — two
 * different measurements under one name. The documented gate failed
 * deterministically (3.42%), CI stayed green on a narrower scope (1.97%), and
 * a permanently red gate is an invitation to lower the threshold.
 *
 * `.jscpd.json` is strict JSON (unknown keys are rejected by the Rust engine),
 * so it cannot carry the reasons for its own entries. This test is where the
 * policy is written down and enforced: scope, threshold and every exclusion.
 * Editing the config without editing this test fails here first.
 */

const root = new URL("../../../", import.meta.url);
const config = JSON.parse(readFileSync(new URL(".jscpd.json", root), "utf8")) as {
  threshold: number;
  path: string[];
  ignore: string[];
};

/** The two directories the shipping source lives in. Also what ci.yml scans. */
const SHIPPING_SOURCE = ["apps/api/src", "apps/web/src"];

describe("duplication gate scope (F-13)", () => {
  it("scans exactly the shipping source CI scans — not the whole repo", () => {
    expect(config.path).toEqual(SHIPPING_SOURCE);

    // CI resolves the same config file, but passes the paths explicitly. If
    // either side moves, the gate stops measuring the same tree and this fails.
    const ci = readFileSync(new URL(".github/workflows/ci.yml", root), "utf8").split(/\r?\n/);
    const jscpdLine = ci.find((line) => line.includes("npx jscpd"));
    expect(jscpdLine, "no jscpd invocation found in .github/workflows/ci.yml").toBeDefined();
    expect(jscpdLine).toContain(`${SHIPPING_SOURCE[0]} ${SHIPPING_SOURCE[1]}`);
    expect(jscpdLine).toContain(`--threshold ${config.threshold}`);
  });

  it("keeps the duplication threshold at 3 (a ratchet)", () => {
    // AGENTS.md §9 / CONTRIBUTING.md: duplication ≤ 3%. Never lower — and if
    // the measured number moves, the threshold stays where the policy put it.
    expect(config.threshold).toBe(3);
  });

  it("excludes only reviewed paths, each for a stated reason", () => {
    // Every entry below is policy, not convenience. Production source is never
    // excluded: a duplicate cluster in the code that ships is a finding.
    const reasonedExclusions = new Set([
      // Build/test output and vendored trees — no shipped code inside.
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/test-results/**",
      "**/playwright-report/**",
      // Untracked audit/agent evidence trees (F-21); not part of the product.
      "**/.audit/**",
      "**/qa-evidence/**",
      "**/qa-screenshots/**",
      // Generated Prisma client/schema copies — generated, single writer.
      "**/prisma/**",
      // Documentation and lockfiles are already covered by their own gates.
      "**/*.md",
      "**/package-lock.json",
      // The committed Android native project is Capacitor-generated.
      "apps/web/android/**",
      // Co-located web unit tests: the web app keeps tests under src/, so a
      // raw source-scope scan dragged ~800 lines of test-harness boilerplate
      // (mocked-fetch/route harnesses) into the duplication ratio. Tests are
      // not shipping source; their shared fixtures belong in a helper, which
      // review covers, not this ratio. Production modules stay in scope.
      "**/*.test.ts",
      "**/*.test.tsx",
    ]);
    expect(new Set(config.ignore)).toEqual(reasonedExclusions);
  });
});
