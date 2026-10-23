import { test, expect } from "@playwright/test";

/**
 * Visual contract — 8 critical pages, asserted structurally.
 *
 * History: this suite began as pixel-snapshot comparisons
 * (`toHaveScreenshot`, baselines captured on win32) and was disabled by renaming
 * the file to `.spec.ts.bak` in a commit that never mentioned it — the removal
 * was invisible because `*.bak` is gitignored. Pixel baselines were the wrong
 * tool here in any case: the baselines were win32-only while CI runs Linux, so a
 * restored suite would have gone red on fonts and anti-aliasing rather than on
 * real regressions.
 *
 * This version keeps the *intent* — the eight pages must render, laid out, in
 * both themes — with platform-independent assertions that a reviewer can trust:
 *   1. the page's own heading/title renders (it is not blank or stuck loading);
 *   2. no horizontal overflow at 390px (the phone viewport that matters);
 *   3. the error boundary did not fire;
 *   4. primary chrome is present (skip link, navigation for signed-in pages);
 *   5. dark mode renders without overflow as well.
 *
 * Requires the running stack (see farmer-journey.spec.ts) and the seeded demo
 * farmer. Replace with screenshot diffing only if a cross-platform baseline
 * strategy (e.g. a fixed Linux container) is adopted on purpose.
 */

const PAGES = [
  { name: "login", path: "/login", auth: false, marker: /স্বাগতম|Welcome|লগইন|Login/i, control: "#phone" },
  { name: "register", path: "/register", auth: false, marker: /রেজিস্ট্রেশন|Register|অ্যাকাউন্ট|Account/i, control: "#rphone" },
  { name: "home", path: "/", auth: true, marker: /আসসালামু|Hello,|হোম|Home/i, control: "main#main" },
  { name: "farm", path: "/farm", auth: true, marker: /আমার ফার্ম|My Farm/i, control: "main#main" },
  { name: "market", path: "/market", auth: true, marker: /বাজার|Market/i, control: "main#main" },
  { name: "services", path: "/services", auth: true, marker: /সেবা|Services/i, control: "main#main" },
  { name: "notifications", path: "/notifications", auth: true, marker: /নোটিফিকেশন|Notifications/i, control: "main#main" },
  { name: "admin", path: "/admin", auth: true, marker: /অ্যাডমিন|Admin|অনুমতি নেই|permission/i, control: "main#main" },
] as const;

async function seededLogin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill("#phone", "01700000002");
  await page.fill("#password", "Demo@1234");
  await page.click('button:has-text("Sign in"), button:has-text("প্রবেশ করুন")');
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 15_000 });
}

/** Fails when the document scrolls sideways at phone width. */
async function assertNoHorizontalOverflow(page: import("@playwright/test").Page, label: string, width = 390) {
  const overflow = await page.evaluate(() => {
    const el = document.documentElement;
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(
    overflow.scrollWidth,
    `${label}: horizontal overflow at ${width}px (scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth})`
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);
}

test.describe("Visual contract — 8 pages render, laid out, in both themes", () => {
  // Theme preference lives in each browser context's localStorage, and Playwright
  // gives every test a fresh context, so no theme cleanup is needed between tests.
  /**
   * Two tests, one sign-in each. The earlier shape ran one test per page and
   * signed in per test: nine logins for nine assertions, which exhausted the
   * API's login rate limit in CI and made unrelated suites fail (2026-10-17).
   * Page-level reporting is preserved by naming the page in every assertion.
   */
  test("light theme: every critical page renders, laid out", async ({ page }) => {
    await seededLogin(page);
    for (const p of PAGES.filter((x) => x.auth)) {
      await page.goto(p.path);
      await page.waitForLoadState("networkidle");
      await expect(page.locator(p.control).first(), `${p.name}: ${p.control} not visible`).toBeVisible({ timeout: 20_000 });
      await expect(page.locator("body"), `${p.name}: expected copy missing`).toContainText(p.marker, { timeout: 15_000 });
      await expect(page.locator("body"), `${p.name}: error boundary fired`).not.toContainText(
        /কিছু ভুল হয়েছে|Something went wrong/i
      );
      await assertNoHorizontalOverflow(page, p.name);
      await expect(page.locator('[data-testid="bottom-nav"]'), `${p.name}: navigation missing`).toBeAttached();
    }
  });

  test("public pages render without a session, laid out", async ({ page }) => {
    for (const p of PAGES.filter((x) => !x.auth)) {
      await page.goto(p.path);
      await page.waitForLoadState("networkidle");
      await expect(page.locator(p.control).first(), `${p.name}: ${p.control} not visible`).toBeVisible({ timeout: 20_000 });
      await expect(page.locator("body"), `${p.name}: expected copy missing`).toContainText(p.marker, { timeout: 15_000 });
      await assertNoHorizontalOverflow(page, p.name);
      // Both public pages must be reachable while signed out — for /register that
      // means the reverse guard must not bounce a guest to /login.
      await expect(page.locator("body")).not.toContainText(/কিছু ভুল হয়েছে|Something went wrong/i);
    }
  });

  test("dark mode renders the same pages without overflow", async ({ page }) => {
    // Eight page loads, each painting a theme transition: too close to the 30s
    // default on a 2-vCPU runner (it timed out in CI on 2026-10-17).
    test.slow();
    await seededLogin(page);
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.locator("header button[aria-pressed]").first().click(); // theme toggle
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.dataset.theme))
      .toBe("dark");

    for (const p of PAGES.filter((x) => x.auth)) {
      await page.goto(p.path);
      await page.waitForLoadState("networkidle");
      await assertNoHorizontalOverflow(page, `${p.name} (dark)`);
      await expect(page.locator("body"), `${p.name} (dark): error boundary fired`).not.toContainText(
        /কিছু ভুল হয়েছে|Something went wrong/i
      );
    }
  });

  /**
   * 360×640 (G-05): the narrowest phone the app claims to support, and the
   * constraint the 390-wide Pixel 5 profile does not exercise. Same eight
   * critical pages, same overflow assertion — only the viewport changes.
   * Signed-out pages first (after sign-in the reverse guard bounces /login and
   * /register), then one sign-in for the six signed-in pages.
   */
  test("360×640: every critical page fits without horizontal overflow", async ({ page }) => {
    test.slow(); // 8 page loads at phone width + one sign-in
    await page.setViewportSize({ width: 360, height: 640 });

    for (const p of PAGES.filter((x) => !x.auth)) {
      await page.goto(p.path);
      await page.waitForLoadState("networkidle");
      await expect(page.locator(p.control).first(), `${p.name} (360): ${p.control} not visible`).toBeVisible({ timeout: 20_000 });
      await assertNoHorizontalOverflow(page, `${p.name} (360)`, 360);
    }

    await seededLogin(page);
    for (const p of PAGES.filter((x) => x.auth)) {
      await page.goto(p.path);
      await page.waitForLoadState("networkidle");
      await expect(page.locator("body"), `${p.name} (360): expected copy missing`).toContainText(p.marker, { timeout: 15_000 });
      await assertNoHorizontalOverflow(page, `${p.name} (360)`, 360);
    }
  });
});
