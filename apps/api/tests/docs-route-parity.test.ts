import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * API docs drift guard (J-05).
 *
 * The audit found router families mounted in code that `docs/api.md` never
 * mentions (`/organizations`, `/analytics`, the withdrawal queue) — the doc is
 * the only API contract users of this repo have, and a route that exists but is
 * undiscoverable is drift in the direction that hurts least; a route the doc
 * promises but code does not serve is drift in the direction that wastes a
 * client developer's day. This test closes the cheaper half automatically:
 * every base path the app mounts must appear in the reference, and the failure
 * message names the doc's sections so the fix is one edit away.
 *
 * The parse is deliberately of the *source registration*, not an exported list:
 * a route added to `app.ts` must fail this test even if nobody remembers it.
 */

const apiRoot = fileURLToPath(new URL("..", import.meta.url)); // apps/api/
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url)); // repo root
const APP_TS = `${apiRoot}src/app.ts`.replace(/\\/g, "/");
const DOC = `${repoRoot}docs/api.md`.replace(/\\/g, "/");

/**
 * Mounted paths that intentionally stay out of the public API reference, with
 * the reason. Keep this list boring: an entry here means "do not document",
 * not "the doc is behind".
 */
const NOT_IN_PUBLIC_REFERENCE: Record<string, string> = {
  "/metrics":
    "internal Prometheus endpoint, guarded by METRICS_TOKEN in production; documented in docs/operations.md §Metrics, deliberately absent from the public reference (no client should scrape it).",
};

/** All `v1.use("<path>", <router>)` registrations in app.ts, in source order. */
function mountedV1Paths(): string[] {
  const src = readFileSync(APP_TS, "utf8");
  const mounts = [...src.matchAll(/v1\.use\(\s*"(\/[^"]+)"\s*,\s*([A-Za-z0-9_]+)\s*\)/g)].map((m) => m[1]!);
  // dedupe (payments is mounted twice: webhook router first, then the api router)
  return [...new Set(mounts)];
}

/** App-level health/observability GETs (registered directly on `app`). */
function appLevelGets(): string[] {
  const src = readFileSync(APP_TS, "utf8");
  return [...src.matchAll(/app\.get\(\s*"(\/[^"]+)"\s*,/g)].map((m) => m[1]!);
}

const doc = readFileSync(DOC, "utf8");
const docSections = [...doc.matchAll(/^#{2,3} (.+)$/gm)].map((m) => m[1]!.trim());

describe("docs/api.md route parity", () => {
  it("every mounted v1 router base path appears in the API reference", () => {
    const mounted = mountedV1Paths();
    const missing = mounted.filter((p) => !doc.includes(p) && !(p in NOT_IN_PUBLIC_REFERENCE));
    const message =
      `Router(s) mounted in apps/api/src/app.ts but absent from docs/api.md:\n` +
      missing.map((p) => `  - ${p} (mounted as v1.use("${p}", …))`).join("\n") +
      (missing.length
        ? `\nFix: add the path to a section in docs/api.md. Existing sections: ${docSections
            .map((s) => `"${s}"`)
            .join(", ")}.` +
          `\n(intentionally undocumented, allowlisted in NOT_IN_PUBLIC_REFERENCE: ` +
          `${Object.keys(NOT_IN_PUBLIC_REFERENCE).join(", ") || "none"})`
        : "");
    expect(missing, message).toEqual([]);
  });

  it("health and readiness endpoints are documented (no auth required)", () => {
    const missing = appLevelGets().filter(
      (p) => !doc.includes(p) && p !== "/" /* service root */ && !(p in NOT_IN_PUBLIC_REFERENCE),
    );
    const message =
      `App-level endpoint(s) registered on \`app\` but absent from docs/api.md:\n` +
      missing.map((p) => `  - ${p}`).join("\n") +
      (missing.length ? `\nFix: document ${missing.join(", ")} in docs/api.md (Health section) or add to NOT_IN_PUBLIC_REFERENCE with a reason.` : "");
    expect(missing, message).toEqual([]);
  });

  it("the scan itself is not vacuous", () => {
    // If app.ts is restructured (routes exported elsewhere, app factory split),
    // fail here rather than silently asserting about an empty list.
    expect(mountedV1Paths().length).toBeGreaterThanOrEqual(18);
    expect(docSections.length).toBeGreaterThan(10);
  });
});
