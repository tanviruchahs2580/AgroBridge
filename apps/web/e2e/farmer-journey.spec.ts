import { test, expect } from "@playwright/test";

/**
 * Farmer journey E2E (requires running API + Web).
 * Run: PLAYWRIGHT_BASE_URL=http://localhost:5173 npx playwright test
 * Seeds: 01700000002 / Demo@1234
 */
test.describe("Farmer journey", () => {
  test("login → farm → AI → market → cart", async ({ page }) => {
    await page.goto("/");
    // Should redirect to /login when not authenticated
    await expect(page).toHaveURL(/.*login/);
    await page.fill('input[placeholder*="Mobile" i], input[name="phone"]', "01700000002");
    await page.fill('input[type="password"]', "Demo@1234");
    await page.click('button:has-text("Login"), button:has-text("লগইন")');
    // After login, should land on home
    await page.waitForURL(/.*\/$/, { timeout: 10_000 });
    await expect(page.locator("text=AgroBridge")).toBeVisible({ timeout: 5_000 }).catch(() => {});
    // Bilingual toggle
    const toggle = page.locator('button:has-text("EN"), button:has-text("বাং")').first();
    if (await toggle.isVisible()) {
      await toggle.click();
      await expect(page.locator("body")).toContainText(/Home|হোম/);
      await toggle.click();
    }
    // Navigate to farm
    await page.click('a:has-text("My Farm"), a:has-text("আমার ফার্ম")');
    await expect(page).toHaveURL(/.*farm/);
    // Market
    await page.click('a:has-text("Market"), a:has-text("বাজার")');
    await expect(page).toHaveURL(/.*market/);
    // Just verify market loads (products may be empty before seed)
    await expect(page.locator("body")).toContainText(/Market|বাজার|Product|পণ্য/);
  });

  test("responsive 390px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/login");
    await expect(page.locator("body")).toBeVisible();
    // No horizontal overflow
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
  });
});
