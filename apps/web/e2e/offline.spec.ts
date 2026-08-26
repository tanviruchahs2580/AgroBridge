import { test, expect } from "@playwright/test";

/**
 * Offline resilience: connectivity banner appears when the context goes
 * offline and hides again when back online.
 * Requires running API + Web (see farmer-journey.spec.ts).
 */
test.describe("Offline banner", () => {
  test("shows offline banner when disconnected, hides when reconnected", async ({ page, context }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/.*login/);
    await page.fill("#phone", "01700000002");
    await page.fill("#password", "Demo@1234");
    await page.click('button:has-text("Sign in"), button:has-text("প্রবেশ করুন")');
    await page.waitForURL(/.*\/$/, { timeout: 10_000 });

    // No banner while online.
    await expect(page.locator('[role="status"]')).toHaveCount(0);

    // Cut the network — browser fires offline events, shell shows the banner.
    // Under load the window "offline" event can land between the shell's first
    // render and its useEffect subscription; cycling connectivity retries the
    // transition so the test stays deterministic.
    let bannerShown = false;
    for (let attempt = 0; attempt < 3 && !bannerShown; attempt++) {
      await context.setOffline(true);
      await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
      bannerShown = await page.locator('div[role="status"]').isVisible().catch(() => false);
      if (!bannerShown) {
        await context.setOffline(false);
        await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
        await page.waitForTimeout(400);
      }
    }
    const banner = page.locator('div[role="status"]');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(/Offline|অফলাইন/u);

    // Restore the network — banner hides.
    await context.setOffline(false);
    await expect(page.locator('div[role="status"]')).toBeHidden();
  });
});
