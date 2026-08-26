import { test, expect } from "@playwright/test";

/**
 * English mode: toggling the language switch must re-render navigation in English.
 * Requires running API + Web (see farmer-journey.spec.ts).
 * Seeds: 01700000002 / Demo@1234 — language preference persists on the seeded
 * account, so the test normalizes to Bengali first for a deterministic start.
 */
test.describe("English mode toggle", () => {
  const enToggle = 'header button:has-text("EN")';
  const bnToggle = "header button:has-text(\"বাং\")";

  test("EN toggle renders nav labels in English", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/.*login/);
    await page.fill("#phone", "01700000002");
    await page.fill("#password", "Demo@1234");
    await page.click('button:has-text("Sign in"), button:has-text("প্রবেশ করুন")');
    await page.waitForURL(/.*\/$/, { timeout: 10_000 });

    // Normalize: wait for the shell toggle, then ensure we start from Bengali
    // (toggle offers "বাং" when the UI is currently English).
    const enButton = page.locator(enToggle);
    const bnButton = page.locator(bnToggle);
    await expect(enButton.or(bnButton)).toBeVisible();
    if (await bnButton.isVisible()) {
      await bnButton.click();
      await expect(page.getByRole("link", { name: /বাজার/u }).first()).toBeVisible();
    }

    // Seeded farmer defaults to Bengali — the switch now offers "EN".
    await expect(enButton).toBeVisible();
    await enButton.click();

    // Primary nav labels render in English (sidebar on desktop, bottom nav on mobile).
    for (const label of ["Home", "My Farm", "Market", "Wallet"]) {
      await expect(page.getByRole("link", { name: new RegExp(`^\\S*\\s*${label}$`, "u") }).first()).toBeVisible();
    }

    // Document language attribute follows the UI language.
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe("en");

    // Toggling back restores Bengali labels (also resets persisted pref).
    await page.locator(bnToggle).click();
    await expect(page.getByRole("link", { name: /বাজার/u }).first()).toBeVisible();
  });
});
