import { test, expect } from "@playwright/test";

/**
 * Regression: a farm card opens the detail view on click anywhere, and the
 * inline "add plot" form is rendered *inside* that card. Without a guard on the
 * card's click handler, clicking any field of that form bubbles to the card,
 * swaps the page to the detail view and destroys the form — so adding a plot to
 * an existing farm was impossible with a pointer. Measured on the broken code:
 * clicking the plot-name field left `detailAppeared=true formStillThere=false`.
 *
 * Also pins the ARIA shape: the card must not be `role="button"`, because a
 * button's descendants are presentational and this card contains real buttons and
 * form controls.
 */

async function seededLogin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill("#phone", "01700000002");
  await page.fill("#password", "Demo@1234");
  await page.click('button:has-text("Sign in"), button:has-text("প্রবেশ করুন")');
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 15_000 });
}

test.describe("my farm — card interaction", () => {
  test("clicking inside the inline add-plot form does not swap to the detail view", async ({ page }) => {
    await seededLogin(page);
    await page.goto("/farm");
    await page.waitForLoadState("networkidle");

    const addPlot = page.locator('button:has-text("প্লট"), button:has-text("plot")').first();
    await expect(addPlot).toBeVisible({ timeout: 20_000 });
    await addPlot.click();

    const plotName = page.getByPlaceholder(/প্লটের নাম|Plot name/i).first();
    await expect(plotName, "the inline add-plot form did not open").toBeVisible({ timeout: 5_000 });

    await plotName.click();
    // Typing exercises the same path as a real user filling the form in.
    await plotName.fill("পরীক্ষা প্লট");

    // The detail view is the only view with the back control.
    await expect(page.locator('button:has-text("←")'), "the farm detail view replaced the list").toHaveCount(0);
    await expect(plotName, "the add-plot form was destroyed by the card click").toBeVisible();
    await expect(plotName).toHaveValue("পরীক্ষা প্লট");
  });

  test("the farm card is not exposed as a button", async ({ page }) => {
    await seededLogin(page);
    await page.goto("/farm");
    await page.waitForLoadState("networkidle");
    await expect(page.locator('button:has-text("প্লট"), button:has-text("plot")').first()).toBeVisible({ timeout: 20_000 });

    // A card containing buttons and a form must not claim role="button".
    await expect(page.locator('[role="button"]')).toHaveCount(0);
  });
});
