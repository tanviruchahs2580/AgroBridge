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

    // Toggling back restores Bengali labels AND must persist it: every later spec
    // starts a fresh browser context and hydrates the language from the account, so a
    // restore that only reached the UI leaks English into the rest of the suite (it did
    // on 2026-10-17 — T2, T8 and the visual-contract scan then failed for the wrong
    // reason). Asserting the persisted preference is the difference between "the label
    // changed" and "the next spec will start in Bengali".
    await page.locator(bnToggle).click();
    await expect(page.getByRole("link", { name: /বাজার/u }).first()).toBeVisible();
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const raw = localStorage.getItem("ab_at"); // sessionManager owns this key
            const res = await fetch("/api/v1/auth/me", { headers: raw ? { Authorization: `Bearer ${raw}` } : {} });
            if (!res.ok) return `http_${res.status}`;
            const body = await res.json();
            return body?.data?.langPref ?? "missing";
          }),
        { timeout: 10_000, message: "the Bengali preference never reached the server — later specs would start in English" }
      )
      .toBe("bn");
  });
});
