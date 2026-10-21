import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Accessibility regression gate (WCAG A/AA focus).
 * Requires running API + Web (see farmer-journey.spec.ts).
 * Seeds: 01700000002 / Demo@1234
 *
 * Authenticated scans share one login session; CI's e2e job raises the auth
 * and global rate limits for its throwaway instance (docs/testing.md,
 * AUD-134), so the suite does not depend on staying under the production
 * login budget.
 */

/** Critical/serious violations block the build; moderate/minor are tracked separately. */
function criticalSerious(violations: { id: string; impact: string | null; description: string; nodes: { target: unknown }[] }[]) {
  return violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `${v.id} (${v.impact}): ${v.description} -> ${JSON.stringify(v.nodes.slice(0, 3).map((n) => n.target))}`);
}

async function assertNoCriticalSerious(page: import("@playwright/test").Page) {
  const builder = new AxeBuilder({ page });
  // Accepted exclusion (review quarterly alongside SECURITY_WAIVERS.md):
  // form div.rounded-md.bg-stone-50 — demo-credentials hint rendered only
  // under import.meta.env.DEV; ships in no production bundle.
  // The former `.text-stone-400` exclusion is gone: muted meta text was bumped
  // to stone-500 in the shared components (Stepper, Input placeholder) so the
  // gate now sees those nodes instead of looking away from them.
  const results = await builder
    .exclude("form div.rounded-md.bg-stone-50")
    .analyze();
  const offenders = criticalSerious(results.violations as never);
  if (offenders.length > 0) throw new Error(`Critical/serious a11y violations on ${page.url()}:\n${offenders.join("\n")}`);
  expect(offenders).toEqual([]);
}

async function seededLogin(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/.*login/);
  await page.fill("#phone", "01700000002");
  await page.fill("#password", "Demo@1234");
  await page.click('button:has-text("Sign in"), button:has-text("প্রবেশ করুন")');
  await page.waitForURL(/.*\/$/, { timeout: 10_000 });
}

test.describe("Accessibility scans", () => {
  test("/login has zero critical/serious violations", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("#phone")).toBeVisible();
    await assertNoCriticalSerious(page);
  });

  // Non-default state: the error banner + toast (danger triplet) and the
  // aria-invalid inputs only exist after a failed submit, so the clean-form
  // scan above would never have seen them.
  test("/login error state (wrong credentials) has zero critical/serious violations", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#phone", "01700000002");
    await page.fill("#password", "definitely-wrong-pass");
    await page.click('button:has-text("Sign in"), button:has-text("প্রবেশ করুন")');
    await expect(page.locator('[role="alert"]').first()).toBeVisible({ timeout: 10_000 });
    await assertNoCriticalSerious(page);
  });

  test("authenticated shell: /, /market, /wallet have zero critical/serious violations", async ({ page }) => {
    await seededLogin(page);

    // Shell structure: skip link, main landmark, primary nav. The nav's
    // aria-label is localized, so the assertion keys on the landmark itself
    // (BottomNav is the only labelled nav in the shell) rather than on English copy.
    await expect(page.locator('a[href="#main"]')).toBeAttached();
    await expect(page.locator("main#main")).toBeVisible();
    await expect(page.locator("nav[aria-label]")).toBeAttached();

    for (const route of ["/", "/market", "/wallet"]) {
      await page.goto(route);
      await expect(page.locator("#main")).toBeVisible();
      // Ensure dynamic data (weather, farms) has loaded before axe — avoids skeleton false positives
      await page.waitForTimeout(800);
      await page.waitForLoadState("networkidle").catch(() => {});
      await assertNoCriticalSerious(page);
    }
  });

  /**
   * The remaining signed-in routes (G-06). Same one-login-per-test pattern as
   * above; five routes at ~4-6s each exceed the 30s default on a 2-vCPU
   * runner, so the test is marked slow. /sell is the sell-crop route in
   * App.tsx's route table.
   */
  test("remaining signed-in routes: /services, /orders, /sell, /settings, /notifications have zero critical/serious violations", async ({ page }) => {
    test.slow();
    await seededLogin(page);

    for (const route of ["/services", "/orders", "/sell", "/settings", "/notifications"]) {
      await page.goto(route);
      await expect(page.locator("#main"), `${route}: main landmark missing`).toBeVisible();
      // Let the page's resources settle (skeletons are not what a user sees last).
      await page.waitForTimeout(800);
      await page.waitForLoadState("networkidle").catch(() => {});
      await assertNoCriticalSerious(page);
    }
  });
});
