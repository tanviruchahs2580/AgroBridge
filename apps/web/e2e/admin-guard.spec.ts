import { test, expect } from "@playwright/test";

/**
 * Admin area guard: a FARMER session must never see admin metrics content.
 * Server returns 403; the panel renders the denied state instead of data.
 * Requires running API + Web (see farmer-journey.spec.ts).
 */
test.describe("Admin route guard", () => {
  test("farmer visiting /admin sees no admin metrics content", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/.*login/);
    await page.fill("#phone", "01700000002");
    await page.fill("#password", "Demo@1234");
    await page.click('button:has-text("Sign in"), button:has-text("প্রবেশ করুন")');
    await page.waitForURL(/.*\/$/, { timeout: 10_000 });

    // Farmer shell has no admin entry point.
    await expect(page.locator('header a[href="/admin"]')).toHaveCount(0);

    // Direct navigation stays on /admin but renders no metric cards.
    await page.goto("/admin");
    await expect(page).toHaveURL(/.*admin/);

    // Denied notice (bilingual) is shown…
    await expect(
      page.getByText(/permission to view this page|প্রবেশের অনুমতি নেই/u).first()
    ).toBeVisible({ timeout: 10_000 });

    // …and none of the admin metrics content is rendered (EN or BN labels).
    for (const label of ["Pending procurement", "Active farmers", "অর্ডার অপেক্ষমাণ", "সক্রিয় কৃষক"]) {
      await expect(page.getByText(label)).toHaveCount(0);
    }
  });
});
