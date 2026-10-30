import { test, expect, type Page } from "@playwright/test";
import { login, registerByApi, DEMO } from "./scenario-helpers.js";

/**
 * PERF-01 — the critical farmer journeys on the throttled low-end profile of
 * G-12: mobile emulation, 4× CPU slowdown, Slow-4G network. Budgets are the
 * Appendix E defaults (fixed before measuring):
 *   LCP ≤ 4.0 s · INP ≤ 200 ms (approx: worst event-timing entry) · CLS ≤ 0.1
 *   initial-route JS ≤ 250 KB compressed · initial page weight ≤ 1 MB compressed
 * Measurements come from the page's own PerformanceObserver and resource
 * entries (transferSize ≈ compressed bytes on the wire).
 */

const BUDGET = { lcpMs: 4000, inpMs: 200, cls: 0.1, jsKb: 250, pageKb: 1024 };

async function throttle(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Network.enable");
  // Lighthouse's documented "Slow 4G" lab profile: 1.6 Mbps down / 750 kbps up,
  // 150 ms RTT. (400 kbps would be the harsher "Slow 3G" preset; measuring an
  // app against a mislabeled profile would rig the budget either way.)
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  await page.addInitScript(() => {
    (window as unknown as { __perf: Record<string, number> }).__perf = { lcp: 0, cls: 0, inp: 0 };
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) (window as unknown as { __perf: Record<string, number> }).__perf.lcp = e.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & { value?: number; hadRecentInput?: boolean })[]) {
        if (!e.hadRecentInput) (window as unknown as { __perf: Record<string, number> }).__perf.cls += e.value ?? 0;
      }
    }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const d = (e as unknown as { duration: number }).duration;
        const w = window as unknown as { __perf: Record<string, number> };
        if (d > w.__perf.inp) w.__perf.inp = d;
      }
    }).observe({ type: "event", buffered: true });
  });
}

async function measure(page: Page) {
  await page.waitForLoadState("load");
  await page.waitForTimeout(2500);
  return page.evaluate(() => {
    const perf = (window as unknown as { __perf: Record<string, number> }).__perf;
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const transfer = (filter: (u: string) => boolean) =>
      resources.filter((r) => filter(r.name)).reduce((s, r) => s + (r.transferSize || 0), 0);
    const fcp = (performance.getEntriesByType("paint").find((e) => e.name === "first-contentful-paint") as PerformanceEntry | undefined)?.startTime ?? 0;
    const top = resources
      .slice()
      .sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0))
      .slice(0, 10)
      .map((r) => `${Math.round((r.transferSize || 0) / 1024)}KB ${r.name.split("/").slice(-1)[0]} @${Math.round(r.responseEnd)}ms`);
    return {
      ...perf,
      fcp,
      top,
      jsBytes: transfer((u) => u.endsWith(".js") || u.includes(".js?")),
      pageBytes: resources.reduce((s, r) => s + (r.transferSize || 0), 0) + (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming)?.transferSize,
    };
  });
}

test.describe("PERF-01 — throttled low-end profile", () => {
  // The production bundle is what a user loads; measuring vite's dev module
  // graph under Slow-4G measures the tooling, not the product. Run with
  // PLAYWRIGHT_BASE_URL=http://127.0.0.1:4173 (npm run build && npx vite preview).
  test("[PERF-01] login, My Farm, an AI question and sandbox checkout stay inside the budgets", async ({ page, request }) => {
    test.setTimeout(300_000);
    // The SPA fallback answers 200 with HTML for any path, so detect the DEV
    // server by the module it actually serves for /@vite/client.
    const viteProbe = await request.get("/@vite/client", { failOnStatusCode: false });
    const viteBody = viteProbe.ok() ? await viteProbe.text() : "";
    test.skip(viteBody.includes("createHotContext"), "run PERF-01 against the production preview build (:4173)");
    const f = await registerByApi(request);
    await throttle(page);

    // 1) Login (the first journey: app shell + login chunk under throttle).
    await page.goto("/login");
    let login_measure = await measure(page);
    // A real user does not tap mid-download: let the first-visit graph settle
    // before interacting, or the POST queues behind dozens of pending chunks
    // and dies on the client's own timeout (observed under 4x CPU + Slow-4G).
    await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => null);
    await page.fill("#phone", f.phone);
    await page.fill("#password", "Demo@1234");
    await page.click('button:has-text("Sign in"), button:has-text("প্রবেশ করুন")');
    try {
      await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 150_000 });
    } catch (e) {
      console.log("LOGIN STALLED at", page.url(), "errors:", await page.locator("[role=alert]").allInnerTexts());
      throw e;
    }

    // 2) Home (post-login), My Farm, one AI answer.
    await page.goto("/farm");
    const farm = await measure(page);
    await page.goto("/advisor");
    await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => null);
    await page.getByPlaceholder(/আপনার প্রশ্ন|Ask your question/).fill("ধানে ব্লাস্ট হলে কী করব?");
    await page.getByRole("button", { name: /পাঠান|Send/ }).first().click();
    await expect(page.getByText(/ব্লাস্ট|blast/i).first()).toBeVisible({ timeout: 60_000 });
    const advisor = await measure(page);

    // 3) Sandbox checkout journey.
    await page.goto("/market");
    await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => null);
    const add = page.locator('button:not([disabled])', { hasText: /কার্টে যোগ করুন|Add to cart/i }).first();
    await expect(add).toBeVisible({ timeout: 90_000 });
    await add.click();
    await page.waitForTimeout(800);
    const market = await measure(page);

    const rows = [
      ["login", login_measure],
      ["farm", farm],
      ["advisor", advisor],
      ["market", market],
    ] as const;
    const report = rows.map(([name, m]) => ({
      journey: name,
      // LCP observers report no candidate on some first-paints (login here);
      // fall back to FCP for that row and say so, rather than passing on 0.
      lcpMs: Math.round(m.lcp > 0 ? m.lcp : m.fcp),
      lcpKind: m.lcp > 0 ? "lcp" : "fcp-fallback",
      inpMs: Math.round(m.inp),
      cls: Number(m.cls.toFixed(3)),
      jsKb: Math.round(m.jsBytes / 1024),
      pageKb: Math.round(m.pageBytes / 1024),
    }));
    console.log("PERF-01 REPORT", JSON.stringify(report, null, 2));
    console.log("LOGIN TOP TRANSFERS", JSON.stringify((login_measure as { top: string[] }).top));

    for (const r of report) {
      // LCP/CLS are asserted on every journey; INP only where an interaction was
      // measured in-page (login IS a navigation-only measurement).
      expect(r.lcpMs, `${r.journey} LCP`).toBeLessThanOrEqual(BUDGET.lcpMs);
      expect(r.cls, `${r.journey} CLS`).toBeLessThanOrEqual(BUDGET.cls);
      expect(r.pageKb, `${r.journey} page weight`).toBeLessThanOrEqual(BUDGET.pageKb);
    }
    const withInteraction = report.filter((r) => r.journey === "advisor" || r.journey === "market");
    for (const r of withInteraction) {
      expect(r.inpMs, `${r.journey} INP (approx)`).toBeLessThanOrEqual(BUDGET.inpMs);
    }
    // Initial-route JS budget applies to the first paint of the app shell.
    expect(report[0].jsKb, "login initial JS").toBeLessThanOrEqual(BUDGET.jsKb);
  });
});
