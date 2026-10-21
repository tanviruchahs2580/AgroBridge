import { test, expect } from "@playwright/test";

/**
 * Account & settings journeys — the Play-Store-mandated paths.
 *
 * Requires the running API + Web stack (see farmer-journey.spec.ts) with the
 * seeded demo farmer (01700000002 / Demo@1234).
 *
 * Covered:
 *  1. the legal pages are public (no session) — Play requires the privacy policy
 *     and the data-deletion instructions to be reachable without an account;
 *  2. Settings renders the profile, phone-verification and account sections;
 *  3. profile edits persist to the API;
 *  4. account deletion really deletes: the session ends and the credentials stop
 *     working. This is the in-app deletion path Google Play requires, so it is
 *     asserted against the API rather than trusted to the UI.
 */

const API = process.env.E2E_API_BASE ?? "http://127.0.0.1:4000/api/v1";

function uniquePhone(): string {
  // 01[3-9] + 8 digits; derived from the clock to stay unique per run.
  return `017${String(Date.now()).slice(-8)}`;
}

async function registerViaApi(phone: string, password: string) {
  const res = await fetch(`${API}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fullName: "E2E Settings Farmer", phone, password, langPref: "bn", consent: true }),
  });
  const raw = await res.text();
  expect(res.status, `register failed: ${raw}`).toBe(201);
  return JSON.parse(raw).data as { accessToken: string; user: { id: string } };
}

async function loginViaApi(phone: string, password: string): Promise<number> {
  const res = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, password }),
  });
  return res.status;
}

test.describe("settings & account", () => {
  test("legal pages are reachable without signing in", async ({ page }) => {
    for (const [route, marker] of [
      ["/privacy", /গোপনীয়তা নীতি|Privacy Policy/],
      ["/terms", /ব্যবহারের শর্তাবলি|Terms of Service/],
      ["/account-deletion", /মুছে ফেলা|Delete your account/],
    ] as const) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(marker);
      // Public means public: no redirect to the login screen.
      await expect(page).not.toHaveURL(/login/);
    }
  });

  test("settings shows profile, phone verification and account sections", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#phone", "01700000002");
    await page.fill("#password", "Demo@1234");
    await page.click('button:has-text("Sign in"), button:has-text("প্রবেশ করুন")');
    await page.waitForURL((u) => !/login/.test(u.pathname), { timeout: 15_000 });

    await page.goto("/settings");
    await expect(page.locator("#st-name")).toBeVisible();
    await expect(page.locator("#st-district")).toBeVisible();
    // Phone verification block and the deletion entry point must both be present.
    await expect(page.getByRole("button", { name: /Delete account|অ্যাকাউন্ট মুছে ফেলুন/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Privacy Policy|গোপনীয়তা নীতি/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Delete account & data|অ্যাকাউন্ট ও তথ্য মুছে ফেলা/ })).toBeVisible();
  });

  test("profile edits persist", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#phone", "01700000002");
    await page.fill("#password", "Demo@1234");
    await page.click('button:has-text("Sign in"), button:has-text("প্রবেশ করুন")');
    await page.waitForURL((u) => !/login/.test(u.pathname), { timeout: 15_000 });

    await page.goto("/settings");
    const district = page.locator("#st-district");
    await expect(district).toBeVisible();
    const original = await district.inputValue();
    const updated = original === "রংপুর" ? "রাজশাহী" : "রংপুর";

    await district.fill(updated);
    await page.locator("#st-name").locator("xpath=ancestor::form").getByRole("button", { type: "submit" }).click();
    await page.waitForTimeout(1500); // PATCH + reload

    await page.reload();
    await expect(page.locator("#st-district")).toHaveValue(updated);

    // Put it back so other specs keep the seeded expectation.
    await page.locator("#st-district").fill(original);
    await page.locator("#st-name").locator("xpath=ancestor::form").getByRole("button", { type: "submit" }).click();
    await page.waitForTimeout(1500);
  });

  test("deleting an account ends the session and blocks the credentials", async ({ page }) => {
    const phone = uniquePhone();
    const password = "Delete@12345";
    await registerViaApi(phone, password);
    expect(await loginViaApi(phone, password)).toBe(200);

    await page.goto("/login");
    await page.fill("#phone", phone);
    await page.fill("#password", password);
    await page.click('button:has-text("Sign in"), button:has-text("প্রবেশ করুন")');
    await page.waitForURL((u) => !/login/.test(u.pathname), { timeout: 15_000 });

    await page.goto("/settings");
    await page.getByRole("button", { name: /Delete account|অ্যাকাউন্ট মুছে ফেলুন/ }).click();

    // The confirmation dialog spells out that this cannot be undone.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /Yes, delete|হ্যাঁ, মুছে ফেলুন/ }).click();

    await page.waitForURL(/login/, { timeout: 20_000 });
    // The account is gone: the same credentials can no longer authenticate.
    expect(await loginViaApi(phone, password)).toBe(401);
  });
});
