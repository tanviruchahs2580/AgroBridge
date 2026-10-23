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
    // Inputs are identified by stable DOM ids (#phone / #password) in pages/Login.tsx
    await page.fill("#phone", "01700000002");
    await page.fill("#password", "Demo@1234");
    await page.click('button:has-text("Sign in"), button:has-text("প্রবেশ করুন")');
    // After login, should land on home
    await page.waitForURL(/.*\/$/, { timeout: 10_000 });
    // The brand must be visible after login; this used to be swallowed with
    // `.catch(() => {})`, which turned a broken shell into a silent pass.
    await expect(page.getByText("এগ্রোব্রিজ").first()).toBeVisible({ timeout: 10_000 });
    // Bilingual toggle
    // Language smoke check. The second click must not just repaint the UI: it PATCHes
    // the account's language, and every later spec hydrates from that value. Ending the
    // test with the request still in flight leaves the suite running in English — which
    // is exactly what happened in CI (run 39056096886) while the same suite passed
    // locally, where the race resolved the other way.
    const toggle = page.locator('button:has-text("EN"), button:has-text("বাং")').first();
    if (await toggle.isVisible()) {
      await toggle.click();
      await expect(page.locator("body")).toContainText(/Home|হোম/);
      await toggle.click();
      await expect
        .poll(
          async () =>
            page.evaluate(async () => {
              const raw = localStorage.getItem("ab_at"); // sessionManager owns this key
              const res = await fetch("/api/v1/auth/me", { headers: raw ? { Authorization: `Bearer ${raw}` } : {} });
              if (!res.ok) return `http_${res.status}`;
              return (await res.json())?.data?.langPref ?? "missing";
            }),
          { timeout: 10_000, message: "the language restore never reached the server — later specs would run in English" }
        )
        .toBe("bn");
    }
    // Navigate to farm
    await page.goto("/farm");
    await expect(page).toHaveURL(/.*farm/);
    // Market
    await page.goto("/market");
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
