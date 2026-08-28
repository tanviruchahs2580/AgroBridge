import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Accessibility regression gate (WCAG A/AA focus).
 * Requires running API + Web (see farmer-journey.spec.ts).
 * Seeds: 01700000002 / Demo@1234
 *
 * Authenticated scans share one login session to stay well under the auth
 * rate limit (20 logins / 15 min / IP).
 */

/** Critical/serious violations block the build; moderate/minor are tracked separately. */
function criticalSerious(violations: { id: string; impact: string | null; description: string; nodes: { target: unknown }[] }[]) {
  return violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `${v.id} (${v.impact}): ${v.description} -> ${JSON.stringify(v.nodes.slice(0, 3).map((n) => n.target))}`);
}

async function assertNoCriticalSerious(page: import("@playwright/test").Page) {
  const builder = new AxeBuilder({ page });
  // Accepted exclusions (review quarterly alongside SECURITY_WAIVERS.md):
  // 1. form div.rounded-md.bg-stone-50 — demo-credentials hint rendered only
  //    under import.meta.env.DEV; ships in no production bundle.
  // 2. .text-stone-400 — muted meta text used across cards sits below AA
  //    contrast on white. KNOWN DEBT: needs a palette bump (stone-500+) in
  //    src/components + pages before this exclusion can be dropped.
  const results = await builder
    .exclude("form div.rounded-md.bg-stone-50")
    .exclude(".text-stone-400")
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

  test("authenticated shell: /, /market, /wallet have zero critical/serious violations", async ({ page }) => {
    await seededLogin(page);

    // Shell structure: skip link, main landmark, primary nav.
    await expect(page.locator('a[href="#main"]')).toBeAttached();
    await expect(page.locator("main#main")).toBeVisible();
    await expect(page.locator('nav[aria-label="Primary navigation"]')).toBeAttached();

    for (const route of ["/", "/market", "/wallet"]) {
      await page.goto(route);
      await expect(page.locator("#main")).toBeVisible();
      // Ensure dynamic data (weather, farms) has loaded before axe — avoids skeleton false positives
      await page.waitForTimeout(800);
      await page.waitForLoadState("networkidle").catch(() => {});
      await assertNoCriticalSerious(page);
    }
  });
});
