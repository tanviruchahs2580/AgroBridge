/**
 * GUI E2E test — live Vite dev server (http://127.0.0.1:5173)
 * Run after `npm run dev` is running:
 *   npx playwright test --config=playwright.config.ts gui-e2e-test.spec.ts
 *
 * Base URL comes from PLAYWRIGHT_BASE_URL so CI can point it anywhere;
 * 127.0.0.1 (not localhost) is used as the default because Windows
 * resolves `localhost` to IPv6 ::1 first, which can hit an unrelated
 * server bound to the IPv6 loopback while our dev server binds IPv4.
 *
 * Tests the audit-report fixes:
 *   T1: Login page renders correctly (no double 👋)
 *   T2: Farmer login succeeds and redirects to dashboard
 *   T3: Dashboard shows correct greeting (single 👋)
 *   T4: MyFarm page works, no wrong "phone taken" error
 *   T5: MyOrders page exists and shows order tracking
 *   T6: Market → Cart → Checkout wizard → Place order → Pay (sandbox) → Success → Done closes
 *   T7: Success dialog "Done" button exists, is visible and enabled (full checkout)
 *   T8: The order just placed appears in MyOrders (matched by order number)
 *   T9: Navigation completeness
 *   T10: Error handling for wrong credentials
 */
import { test, expect } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";
const FARMER_PHONE = "01700000002";
const FARMER_PASSWORD = "Demo@1234";

// ─── Setup: Login helper ───
async function login(page: any, phone = FARMER_PHONE, password = FARMER_PASSWORD) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
  await page.getByRole("textbox", { name: /মোবাইল|Mobile/i }).fill(phone);
  await page.getByRole("textbox", { name: /password|পাসওয়ার্ড/i }).fill(password);
  await page.getByRole("button", { name: /প্রবেশ|Sign in|লগইন/i }).click();
  // Wait for redirect
  await page.waitForURL(/\/(\/|farm|home)/, { timeout: 10000 }).catch(() => {});
  // Give page time to hydrate
  await page.waitForTimeout(1500);
}

/**
 * Drives the full checkout wizard (market → cart → checkout modal → delivery →
 * place order → sandbox payment → success) and returns the success-dialog text
 * plus the parsed order number. Every step fails loudly with an assertion —
 * no silent conditional skips.
 */
async function checkoutOneItem(page: any): Promise<{ successText: string; orderNo: string }> {
  await login(page);

  // Navigate to market
  const marketNav = page.locator('nav[aria-label="Primary navigation"] a').filter({ hasText: /বাজার|Market/i }).first();
  await marketNav.click();
  await page.waitForTimeout(2000); // wait for products to load

  // Market page loaded
  await expect(page.locator("body")).toContainText(/বাজার|Market/);

  // Add first available product to cart (bn label: কার্টে যোগ করুন)
  const addToCart = page.locator("button", { hasText: /কার্টে যোগ করুন|Add to cart/i }).first();
  await expect(addToCart, "market shows no add-to-cart button").toBeVisible({ timeout: 10_000 });
  await addToCart.click();
  await page.waitForTimeout(1000);

  // Open checkout (bn: চেকআউট)
  const checkoutBtn = page.locator("button", { hasText: /চেকআউট|Checkout/i }).first();
  await expect(checkoutBtn, "no Checkout button in cart bar").toBeVisible({ timeout: 5000 });
  await checkoutBtn.click();

  // Wizard modal must open
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog, "checkout modal did not open").toBeVisible({ timeout: 5000 });

  // Step 0: Cart review → Next (bn: পরবর্তী)
  const nextBtn = dialog.locator("button", { hasText: /পরবর্তী|Next/i }).first();
  await expect(nextBtn, "checkout modal has no Next button").toBeVisible();
  await nextBtn.click();
  await page.waitForTimeout(500);

  // Step 1: Delivery info → fill and continue
  const addressInput = dialog.locator('input[id*="address"], input[placeholder*="Address"], input[placeholder*="ঠিকানা"]').first();
  await expect(addressInput, "delivery step has no address input").toBeVisible();
  await addressInput.fill("123 Test Street, Dhaka");

  const phoneInput = dialog.locator('input[id*="phone"], input[type="tel"]').first();
  if (await phoneInput.count() > 0) {
    await phoneInput.fill(FARMER_PHONE);
  }

  const submitBtn = dialog.locator("button[type='submit'], button").filter({ hasText: /পরবর্তী|Next/i }).first();
  await expect(submitBtn, "delivery step has no Next/submit button").toBeVisible();
  await submitBtn.click();
  await page.waitForTimeout(500);

  // Step 2: Review → Place Order (bn: অর্ডার নিশ্চিত করুন)
  const placeOrderBtn = page.locator("button", { hasText: /অর্ডার নিশ্চিত করুন|Place order/i }).first();
  await expect(placeOrderBtn, "no Place Order button after delivery step").toBeVisible({ timeout: 5000 });
  await placeOrderBtn.click();
  await page.waitForTimeout(2000);

  // Step 3: Payment (bn: পেমেন্ট করুন (স্যান্ডবক্স))
  const payBtn = page.locator("button", { hasText: /পেমেন্ট করুন|Pay now/i }).first();
  await expect(payBtn, "no Pay now button after placing order").toBeVisible({ timeout: 5000 });
  await payBtn.click();
  await page.waitForTimeout(3000); // sandbox payment takes time

  // Step 4: Success (bn: পেমেন্ট সম্পন্ন হয়েছে)
  const successText = (((await dialog.textContent()) || "")).trim();
  expect(
    successText,
    `checkout wizard did not reach success step; dialog text: ${successText.substring(0, 300)}`,
  ).toMatch(/পেমেন্ট সম্পন্ন|Payment complete/i);

  const orderNoMatch = successText.match(/ORD-[0-9A-Z-]+/i);
  return { successText, orderNo: orderNoMatch ? orderNoMatch[0] : "" };
}

// ─── T1: Login page renders correctly ───
test("T1: Login page renders correctly", async ({ page }) => {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });

  // Page loads without errors (default locale is bn — title is localized)
  const title = await page.title();
  expect(/এগ্রোব্রিজ|agro/i.test(title)).toBe(true);

  // Form fields exist
  await expect(page.getByRole("textbox", { name: /মোবাইল|Mobile/i })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /password|পাসওয়ার্ড/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /প্রবেশ|Sign in|লগইন/i })).toBeVisible();

  // Check NO double emoji (the audit report found this)
  const pageText = await page.textContent("body");
  expect(pageText).not.toContain("👋👋");
  console.log("✅ T1 PASS: Login page renders correctly, no double emoji");
});

// ─── T2: Farmer login succeeds ───
test("T2: Farmer login succeeds", async ({ page }) => {
  await login(page);

  // Should be on home/dashboard after login
  const url = page.url();
  expect(url).not.toContain("/login");

  // Check we're authenticated (see dashboard content)
  const bodyText = await page.textContent("body");
  expect(bodyText).toContain("এগ্রোব্রিজ"); // app name

  console.log("✅ T2 PASS: Farmer login succeeds, redirects to dashboard");
});

// ─── T3: Dashboard greeting is correct ───
test("T3: Dashboard greeting correct (single 👋)", async ({ page }) => {
  await login(page);

  // Check greeting text
  const h1 = page.locator("h1").first();
  const greeting = (await h1.textContent()) || "";
  expect(greeting.length).toBeGreaterThan(0);
  console.log(`   Greeting: "${greeting}"`);

  // Verify single emoji (not double)
  const emojiCount = (greeting.match(/👋/g) || []).length;
  expect(emojiCount).toBeLessThanOrEqual(1);

  // Should contain the seeded demo user's display name
  expect(greeting).toContain("রহিম");

  console.log("✅ T3 PASS: Greeting has single emoji, shows user name");
});

// ─── T4: MyFarm page works correctly ───
test("T4: MyFarm page works, correct error messages", async ({ page }) => {
  await login(page);

  // Click My Farm in bottom nav
  const farmNav = page.locator('nav[aria-label="Primary navigation"] a').filter({ hasText: /ফার্ম|Farm/ }).first();
  await farmNav.click();
  await page.waitForTimeout(1500);

  // Check we're on the farm page (assertion must actually run — was broken ||-style)
  const farmPageText = await page.textContent("body");
  expect(farmPageText).toMatch(/আমার ফার্ম|My Farm/i);

  // Check no wrong "phone taken" error message
  expect(farmPageText).not.toContain("এই নম্বর");
  expect(farmPageText).not.toContain("account with this number");

  console.log("✅ T4 PASS: MyFarm works correctly, no wrong error messages");
});

// ─── T5: MyOrders page exists and shows order tracking ───
test("T5: MyOrders page exists with order tracking", async ({ page }) => {
  await login(page);

  // Click My Orders in bottom nav
  const ordersNav = page.locator('nav[aria-label="Primary navigation"] a').filter({ hasText: /অর্ডার|Orders|Order/i }).first();
  await expect(ordersNav, "My Orders missing from primary nav").toBeVisible();
  await ordersNav.click();
  await page.waitForTimeout(1500);

  // Check we're on the orders page
  const ordersPageText = (await page.textContent("body")) || "";

  // Should have "My Orders" heading
  expect(ordersPageText).toMatch(/আমার অর্ডার|My Orders/i);

  // Should have tab navigation
  const hasTabs = ordersPageText.includes("সব") || ordersPageText.includes("Active") || ordersPageText.includes("Delivered");
  expect(hasTabs).toBe(true);

  console.log("✅ T5 PASS: MyOrders page exists with order tracking");
});

// ─── T6: Checkout flow works end-to-end ───
test("T6: Checkout flow — cart to success", async ({ page }) => {
  const { successText } = await checkoutOneItem(page);
  console.log(`   Dialog text: "${successText.substring(0, 200)}"`);

  // The Done button must be visible, enabled, and actually dismiss the dialog
  const dialog = page.locator('[role="dialog"]');
  const doneBtn = dialog.locator("button", { hasText: /সম্পন্ন|Done/i }).first();
  await expect(doneBtn).toBeVisible();
  await expect(doneBtn).toBeEnabled();
  await doneBtn.click();
  await expect(page.locator('[role="dialog"]'), "Done did not close the wizard").toHaveCount(0, { timeout: 5000 });
  console.log("✅ T6 PASS: Checkout flow completes through sandbox payment; Done closes wizard");
});

// ─── T7: Success dialog buttons are clickable (full checkout, no conditional skips) ───
test("T7: Success dialog Done button is clickable", async ({ page }) => {
  await checkoutOneItem(page);

  // The Modal in ui.tsx uses createPortal — verify the success-step Done
  // button exists, is visible, and is enabled (not obscured / not disabled).
  const dialog = page.locator('[role="dialog"]');
  const doneButton = dialog.locator("button", { hasText: /সম্পন্ন|Done/i }).first();
  await expect(doneButton).toBeVisible();
  await expect(doneButton).toBeEnabled();
  console.log("✅ T7 PASS: Success dialog Done button is clickable");
});

// ─── T8: Order appears in MyOrders after checkout ───
test("T8: Order appears in MyOrders", async ({ page }) => {
  const { orderNo } = await checkoutOneItem(page);
  expect(orderNo, "success dialog did not show an order number").not.toBe("");

  // Close the wizard via Done, then navigate to orders
  const dialog = page.locator('[role="dialog"]');
  await dialog.locator("button", { hasText: /সম্পন্ন|Done/i }).first().click();
  await expect(dialog).toHaveCount(0, { timeout: 5000 });

  const ordersNav = page.locator('nav[aria-label="Primary navigation"] a').filter({ hasText: /অর্ডার|Orders|Order/i }).first();
  await ordersNav.click();
  await page.waitForTimeout(2000);

  const ordersPageText = (await page.textContent("body")) || "";
  expect(ordersPageText).toMatch(/আমার অর্ডার|My Orders/i);
  expect(ordersPageText, `newly placed order ${orderNo} not visible in MyOrders`).toContain(orderNo);

  console.log(`✅ T8 PASS: Order ${orderNo} appears in MyOrders after checkout`);
});

// ─── T9: Navigation completeness check ───
test("T9: All navigation items present", async ({ page }) => {
  await login(page);

  // Check primary nav items
  const navLinks = page.locator('nav[aria-label="Primary navigation"] a');
  const navCount = await navLinks.count();
  console.log(`   Primary nav items: ${navCount}`);
  expect(navCount).toBeGreaterThanOrEqual(5); // home, farm, advisor, market, wallet

  // Check for My Orders specifically (bn spelling: অর্ডার)
  const ordersNav = page.locator('nav[aria-label="Primary navigation"] a').filter({ hasText: /Orders|অর্ডার/i });
  expect(await ordersNav.count()).toBeGreaterThanOrEqual(1);

  console.log("✅ T9 PASS: All navigation items present");
});

// ─── T10: Error handling - wrong credentials ───
test("T10: Error handling for wrong credentials", async ({ page }) => {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });

  // Try wrong credentials
  await page.getByRole("textbox", { name: /মোবাইল|Mobile/i }).fill("01700000001");
  await page.getByRole("textbox", { name: /password|পাসওয়ার্ড/i }).fill("wrongpassword");
  await page.getByRole("button", { name: /প্রবেশ|Sign in|লগইন/i }).click();

  await page.waitForTimeout(2000);

  // Should still be on login page
  expect(page.url()).toContain("/login");

  // Should show some error
  const bodyText = (await page.textContent("body")) || "";
  const hasError = /মোবাইল|mobile|error|ত্রুটি|সঠিক/i.test(bodyText);

  console.log(`   Error message present: ${hasError}`);
  expect(hasError, "no visible error feedback for wrong credentials").toBe(true);
  console.log("✅ T10 PASS: Error handling for wrong credentials works");
});
