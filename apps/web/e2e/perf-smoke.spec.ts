import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * WEB-09 — key-route timing smoke. The lead runs this (e2e servers are theirs);
 * the numbers go into qa-evidence/receipts/2026-10-19-web-perf-and-timing.md.
 *
 * A smoke, not a benchmark: it measures full navigations to the four key routes
 * with the Navigation Timing + paint entries, prints one table for the QA
 * record, and only fails on ceilings so loose that a failure means the page is
 * broken (or the dev server is), never that a byte moved. Real performance
 * gating is the bundle budget (scripts/preflight.mjs) and Lighthouse
 * (lighthouserc.json).
 *
 * Requires running API + Web (see farmer-journey.spec.ts).
 */

const ROUTES = [
  { route: "/login", auth: false },
  { route: "/", auth: true },
  { route: "/market", auth: true },
  { route: "/orders", auth: true },
] as const;

// Generous on purpose: the dev server (unbundled ESM, thousands of requests on
// a cold 2-vCPU runner) is the slow case. The production preview pass reuses
// these ceilings and lands far below them.
const DCL_CEILING_MS = 4_000;
const LOAD_CEILING_MS = 6_000;

interface RouteTiming {
  route: string;
  dcl: number;
  load: number;
  fcp: number | null;
}

async function readTimings(page: Page, route: string): Promise<RouteTiming> {
  const t = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const paint = performance.getEntriesByType("paint").find((p) => p.name === "first-contentful-paint");
    return {
      dcl: nav ? Math.round(nav.domContentLoadedEventEnd) : -1,
      load: nav ? Math.round(nav.loadEventEnd > 0 ? nav.loadEventEnd : nav.duration) : -1,
      fcp: paint ? Math.round(paint.startTime) : null,
    };
  });
  return { route, ...t };
}

test.describe("Key-route timing smoke (WEB-09)", () => {
  // Four full navigations on the unbundled dev server can outlive the 30s
  // default before the (generous) per-route ceilings get their say; the smoke
  // must fail on a measured number, not on the harness clock.
  test.setTimeout(60_000);

  test("login → home → market → orders navigations stay under the smoke ceilings", async ({ page }) => {
    await page.goto("/login", { waitUntil: "load" });
    await page.fill("#phone", "01700000002");
    await page.fill("#password", "Demo@1234");
    await page.click('button:has-text("Sign in"), button:has-text("প্রবেশ করুন")');
    await page.waitForURL(/.*\/$/, { timeout: 10_000 });

    const timings: RouteTiming[] = [];
    for (const { route } of ROUTES) {
      await page.goto(route, { waitUntil: "load" });
      timings.push(await readTimings(page, route));
    }

    // Compact table for the receipt (the list reporter surfaces console.log).
    const header = "route      DCL(ms)  load(ms)  FCP(ms)";
    const rows = timings.map(
      (t) =>
        `${t.route.padEnd(10)}${String(t.dcl).padStart(7)}${String(t.load).padStart(10)}${String(t.fcp ?? "n/a").padStart(9)}`
    );
    console.log([`[WEB-09] key-route navigation timings (${ROUTES.length} routes)`, header, ...rows].join("\n"));

    for (const t of timings) {
      expect(t.dcl, `${t.route}: DCL ${t.dcl}ms exceeds the smoke ceiling`).toBeLessThan(DCL_CEILING_MS);
      expect(t.load, `${t.route}: load ${t.load}ms exceeds the smoke ceiling`).toBeLessThan(LOAD_CEILING_MS);
    }
  });
});
