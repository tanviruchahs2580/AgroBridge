import { test, expect } from "@playwright/test";

/**
 * AUD-201 acceptance (run only in the audit's candidate clone, not shipped):
 * the farmer uploads a photo, sees the honest pending-review state, and can
 * view the stored image through the new control. Screenshots land under the
 * external acceptance directory so the audit evidence bundle carries them.
 *
 * 1×1 transparent PNG — a real, decodable image with the correct magic bytes
 * (the upload path sniffs content, not filenames, so the bytes must be real).
 */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const OUT = process.env.ACCEPT_DIR ?? ".";

test.describe("disease photo round-trip (AUD-201)", () => {
  test("upload shows pending review and the stored photo is viewable", async ({ page }, testInfo) => {
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });

    await page.goto("/");
    await page.fill("#phone", "01700000002");
    await page.fill("#password", "Demo@1234");
    await page.click('button:has-text("Sign in"), button:has-text("প্রবেশ করুন")');
    await page.waitForURL(/.*\/$/, { timeout: 20_000 });

    await page.goto("/advisor");
    await expect(page.locator('input[type="file"]')).toBeAttached({ timeout: 10_000 });
    await page.setInputFiles('input[type="file"]', { name: "crop.png", mimeType: "image/png", buffer: PNG });

    // The honest pending-review state (either language, the account's choice).
    await expect(page.getByText(/বিশেষজ্ঞ পর্যালোচনাধীন|Pending expert review/).first()).toBeVisible({
      timeout: 15_000,
    });
    await page.screenshot({ path: `${OUT}/IMG-01/screenshots/01-uploaded-pending.png`, fullPage: true });

    // The new view control on the farmer's own case, then the modal image.
    const view = page.locator('button[aria-label="ছবি দেখুন"], button[aria-label="View photo"]').first();
    await expect(view).toBeVisible({ timeout: 10_000 });
    await view.click();

    const img = page.locator('div[role="dialog"] img').first();
    await expect(img).toBeVisible({ timeout: 10_000 });
    await expect
      .poll(async () => img.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 10_000 })
      .toBeGreaterThan(0);
    const src = await img.getAttribute("src");
    expect(src?.startsWith("blob:")).toBe(true);
    await page.screenshot({ path: `${OUT}/IMG-01/screenshots/02-photo-modal.png`, fullPage: true });

    // Close is reachable and returns to the list.
    await page.keyboard.press("Escape");
    await expect(img).toBeHidden({ timeout: 5_000 });

    expect(consoleErrors, consoleErrors.join(" | ")).toEqual([]);
    await testInfo.attach("photo-round-trip", { body: "ok", contentType: "text/plain" });
  });
});
