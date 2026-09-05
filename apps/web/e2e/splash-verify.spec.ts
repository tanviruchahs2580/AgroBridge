import { test, expect } from "@playwright/test";

test.describe("Splash as user", () => {
  test("shows enterprise splash then hides, 390/768/1280", async ({ browser }) => {
    for (const [w, h] of [[390, 844], [768, 1024], [1280, 800]] as const) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 500 });
      const page = await ctx.newPage();
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
      });
      await page.goto("/");
      const splash = page.locator('[data-testid="splash"]');
      await expect(splash).toBeVisible({ timeout: 3000 });
      // Scope to the splash subtree: the app mounts under the overlay ("/" → /login)
      // and its own page h1 coexists while the splash is up — a page-wide h1
      // locator is ambiguous and races the redirect commit.
      await expect(splash.locator("h1")).toContainText("এগ্রোব্রিজ");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
      await expect(splash).toBeHidden({ timeout: 5000 });
      await ctx.close();
    }
  });

  test("reduced-motion shows static splash then hides", async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    const page = await ctx.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });
    await page.goto("/");
    const splash = page.locator('[data-testid="splash"]');
    await expect(splash).toBeVisible({ timeout: 3000 });
    await expect(splash).toBeHidden({ timeout: 3000 });
    await ctx.close();
  });

  test("webdriver skips splash (e2e deterministic)", async ({ page }) => {
    await page.goto("/");
    const splash = page.locator('[data-testid="splash"]');
    await expect(splash).toBeHidden({ timeout: 2000 });
  });
});
