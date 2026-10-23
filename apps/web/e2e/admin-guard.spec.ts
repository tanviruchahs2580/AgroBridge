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

  /**
   * The other direction, which had no test.
   *
   * The panel's role check is now fail-closed on `session.role` instead of waiting
   * for a 403 from the first guarded read — because in that gap a farmer was shown
   * the entire admin console (observed on production: `#main`'s text immediately
   * after the route painted was "Admin Control Tower" plus the user table, swaps to
   * the denial only once the requests settle). Fail-closed is the right default, and
   * its failure mode is the opposite one: hiding the panel from a real admin if the
   * role string ever stops matching. This pins that, so tightening the guard cannot
   * silently lock admins out.
   */
  test("an admin still sees the panel, not the denial", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/.*login/);
    await page.fill("#phone", "01700000001");
    await page.fill("#password", "Demo@1234");
    await page.click('button:has-text("Sign in"), button:has-text("প্রবেশ করুন")');
    await page.waitForURL(/.*\/$/, { timeout: 10_000 });

    // The shell offers the admin entry point to an elevated role.
    await expect(page.locator('header a[href="/admin"]')).toHaveCount(1);

    await page.goto("/admin");
    await expect(page.locator("main#main")).toBeVisible();
    await expect(
      page.getByText(/Admin Control Tower|অ্যাডমিন কন্ট্রোল টাওয়ার/u).first(),
      "the admin panel heading is missing — a fail-closed guard locked out a real admin"
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/permission to view this page|প্রবেশের অনুমতি নেই/u)).toHaveCount(0);
  });
});
