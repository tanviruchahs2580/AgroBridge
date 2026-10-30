import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { api, apiLogin, DEMO, login, logout, registerByApi } from "./scenario-helpers.js";

/**
 * Scenario acceptance — admin, privacy, UX/resilience (Section 10.3).
 *
 * ADM-01 compares the dashboard with database ground truth. The script needs
 * the SAME sqlite file the running API uses: CI's e2e job provisions
 * apps/api/prisma/test.db (the default); a local run with a different stack
 * database passes E2E_DB_URL explicitly.
 */
const here = path.dirname(fileURLToPath(import.meta.url));

test.describe("Scenario acceptance — admin", () => {
  test("[ADM-01] dashboard metrics equal database ground truth; no cross-tenant leak to a farmer", async ({ request }) => {
    // Record a settlement so revenue/orders move relative to a bare database.
    const f = await registerByApi(request);
    const admin = await apiLogin(request, DEMO.admin);
    const dealer = await apiLogin(request, DEMO.dealer);
    const product = await api(request, "post", "/products", dealer.accessToken, {
      name: "মেট্রিক্স পণ্য",
      category: "SEED",
      unit: "PCS",
      pricePaisa: 12_000,
      stockQty: 10,
      sku: `E2E-MET-${Date.now()}`,
    });
    const productId = ((await product.json()) as { data: { id: string } }).data.id;
    await api(request, "post", "/cart/items", f.data.accessToken, { productId, qty: 1 });
    const order = await api(request, "post", "/orders/checkout", f.data.accessToken, { clientRequestId: crypto.randomUUID() });
    const orderId = ((await order.json()) as { data: { id: string } }).data.id;
    const intent = await api(request, "post", "/payments/intent", f.data.accessToken, { purposeType: "ORDER", purposeId: orderId });
    const paymentId = ((await intent.json()) as { data: { paymentId: string } }).data.paymentId;
    await api(request, "post", `/payments/${paymentId}/confirm`, f.data.accessToken, {});

    const metrics = (await (await api(request, "get", "/admin/metrics", admin.accessToken)).json()).data as Record<string, number>;

    // Ground truth from the acceptance database itself (same definitions as the handler).
    const dbUrl = process.env.E2E_DB_URL ?? `file:${path.resolve(here, "../../api/prisma/test.db")}`;
    const truth = JSON.parse(
      execFileSync(process.execPath, [path.resolve(here, "admin-ground-truth.mjs"), dbUrl], { encoding: "utf8" })
    ) as Record<string, number>;
    for (const key of ["farmers", "activeFarmers", "farms", "activeCrops", "orders", "bookings", "pendingProcurement", "revenuePaisa", "aiAdvisoryQueries"]) {
      expect(metrics[key], `metric ${key} drifted from ground truth`).toBe(truth[key]);
    }

    // The farmer must never see the panel's data.
    const forbidden = await api(request, "get", "/admin/metrics", f.data.accessToken);
    expect(forbidden.status()).toBe(403);
  });

  test("[ADM-02] user/status management is permission-gated and audit-logged", async ({ page, request }) => {
    const victim = await registerByApi(request);
    const admin = await apiLogin(request, DEMO.admin);

    // A farmer cannot mutate roles or status.
    expect((await api(request, "patch", `/admin/users/${victim.data.user.id}`, victim.data.accessToken, { status: "SUSPENDED" })).status()).toBe(403);

    // The admin can, and the action lands in the audit log with the target.
    const suspended = await api(request, "patch", `/admin/users/${victim.data.user.id}`, admin.accessToken, { status: "SUSPENDED" });
    expect([200, 204], await suspended.text()).toContain(suspended.status());
    const logs = await (await api(request, "get", "/admin/audit-logs", admin.accessToken)).json();
    const logText = JSON.stringify(logs.data);
    expect(logText).toContain(victim.data.user.id);
    expect(logText).toMatch(/SUSPEND|USER_UPDATE|STATUS/i);
    // The suspended user is cut off immediately.
    expect((await api(request, "get", "/auth/me", victim.data.accessToken)).status()).toBe(401);

    // The panel shows the enforced state in its own table.
    await login(page, DEMO.admin);
    await page.goto("/admin");
    await expect(page.locator("#main")).toContainText(/SUSPENDED|স্থগিত/i, { timeout: 15_000 });
  });

  test("[ADM-03] notifications target their owner and are unreadable by strangers", async ({ request }) => {
    const owner = await registerByApi(request);
    const other = await registerByApi(request);

    // The settlement in ADM-01-style flow emits a CRITICAL notification; simpler:
    // a payout emits one deterministically for the receiving farmer.
    const manager = await apiLogin(request, DEMO.procurement);
    const farm = await api(request, "post", "/farms", owner.data.accessToken, { name: "নোটিফ খামার", district: "রংপুর" });
    const farmId = ((await farm.json()) as { data: { id: string } }).data.id;
    const offer = await api(request, "post", "/procurement/offers", owner.data.accessToken, { farmId, cropName: "RICE", quantityKg: 60, moisturePct: 14, qualityGrade: "A" });
    const poId = ((await offer.json()) as { data: { id: string } }).data.id;
    for (const action of ["QC_PASS", "ISSUE_PO", "COLLECT"]) await api(request, "post", `/procurement/${poId}/review`, manager.accessToken, { action });
    await api(request, "post", "/payments/payouts", manager.accessToken, { poId });

    const ownerFeed = (await (await api(request, "get", "/notifications", owner.data.accessToken)).json()).data as {
      items: { id: string; titleBn: string }[];
    };
    expect(ownerFeed.items.length).toBeGreaterThan(0);
    const notifId = ownerFeed.items[0].id;

    // A stranger cannot read or mark it.
    expect((await api(request, "post", `/notifications/${notifId}/read`, other.data.accessToken, {})).status()).toBe(404);
    // …and their own feed does not contain it.
    const otherFeed = (await (await api(request, "get", "/notifications", other.data.accessToken)).json()).data as { items: { id: string }[] };
    expect(otherFeed.items.some((n) => n.id === notifId)).toBe(false);
  });
});

test.describe("Scenario acceptance — privacy", () => {
  test("[PRIV-01] export downloads real data; deletion ends the session and blocks the credentials", async ({ page, request }) => {
    const f = await registerByApi(request);
    await login(page, { phone: f.phone, password: "Demo@1234" });
    await page.goto("/settings");

    // Export: the browser receives a real file (or the documented toast while
    // the same endpoint is proven to return the caller's data).
    const downloadPromise = page.waitForEvent("download", { timeout: 12_000 }).catch(() => null);
    const exportBtn = page.locator("button", { hasText: /ডেটা|Data|এক্সপোর্ট|Export/i }).first();
    await expect(exportBtn).toBeVisible({ timeout: 10_000 });
    await exportBtn.click();
    const download = await downloadPromise;
    const exported = await request.get("/api/v1/auth/me/export", {
      headers: { Authorization: `Bearer ${f.data.accessToken}` },
    });
    expect(exported.status()).toBe(200);
    expect(await exported.text()).toContain(f.phone);
    if (download) {
      const file = download.suggestedFilename();
      expect(file.length).toBeGreaterThan(0);
    } else {
      await expect(page.getByText(/ডাউনলোড শুরু|Download started/).first()).toBeVisible({ timeout: 10_000 });
    }

    // Deletion: confirm dialog → session ends → credentials blocked, and stay blocked.
    await page.locator("button", { hasText: /অ্যাকাউন্ট মুছে ফেলুন|Delete account/ }).first().click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 8_000 });
    await dialog.locator("button", { hasText: /হ্যাঁ, মুছে ফেলুন|Yes, delete/i }).first().click();
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    const relogin = await request.post("/api/v1/auth/login", { data: { phone: f.phone, password: "Demo@1234" } });
    expect(relogin.status()).toBe(401);
    await page.reload();
    await expect(page).toHaveURL(/\/login/);
    const again = await request.post("/api/v1/auth/login", { data: { phone: f.phone, password: "Demo@1234" } });
    expect(again.status()).toBe(401);
  });

  test("[PRIV-02] analytics and the audit trail never carry the full phone number", async ({ page, request }) => {
    const f = await registerByApi(request);
    const payloads: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/analytics")) payloads.push(`${r.url()} ${r.postData() ?? ""}`);
    });
    await login(page, { phone: f.phone, password: "Demo@1234" });
    await page.goto("/market");
    await page.waitForTimeout(2500);
    for (const b of payloads) {
      expect(b.includes(f.phone), `analytics payload leaked the full phone: ${b.slice(0, 120)}`).toBe(false);
    }
    const admin = await apiLogin(request, DEMO.admin);
    const logs = await (await api(request, "get", "/admin/audit-logs", admin.accessToken)).json();
    expect(JSON.stringify(logs.data).includes(f.phone)).toBe(false);
  });
});

test.describe("Scenario acceptance — UX & resilience", () => {
  test("[UX-01] no horizontal overflow at 360/768/1280 on critical routes", async ({ page }) => {
    await login(page, DEMO.farmer);
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: width === 1280 ? 900 : 800 });
      for (const route of ["/", "/farm", "/market", "/advisor", "/wallet", "/orders"]) {
        await page.goto(route);
        await page.waitForTimeout(600);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `route ${route} overflows at ${width}px`).toBeLessThanOrEqual(1);
      }
    }
  });

  test("[UX-02] keyboard basics: tab order, visible focus, dialog Escape restores focus", async ({ page }) => {
    await page.goto("/login");
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toBeVisible();

    // A closable dialog: Escape closes it and focus returns to its opener.
    // (The checkout wizard deliberately has no mid-flow Escape — state loss.)
    const f = await registerByApi(page.request);
    await login(page, { phone: f.phone, password: "Demo@1234" });
    await page.goto("/settings");
    const opener = page.locator("button", { hasText: /অ্যাকাউন্ট মুছে ফেলুন|Delete account/ }).first();
    await expect(opener).toBeVisible({ timeout: 10_000 });
    await opener.click();
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 8_000 });
    await page.keyboard.press("Escape");
    await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 5_000 });
    const restored = await page.evaluate(() => document.activeElement?.textContent ?? "");
    expect(restored).toMatch(/অ্যাকাউন্ট মুছে ফেলুন|Delete account/);
  });

  test("[UX-04] Bangla input with combining signs, digits and long names persists intact", async ({ page, request }) => {
    const f = await registerByApi(request);
    const longName = "উত্তর-পশ্চিম চর দেলুয়াবাদ কৃষি খামার — ২য় ব্লক, ১২ নং সীমানা";
    await login(page, { phone: f.phone, password: "Demo@1234" });
    await page.goto("/farm");
    await page.getByRole("button", { name: /নতুন ফার্ম|Add Farm/ }).first().click();
    await page.fill("#fm-name", longName);
    await page.fill("#fm-area", "3.5");
    await page.locator("form button[type='submit']").first().click();
    await expect(page.getByText(longName).first()).toBeVisible({ timeout: 10_000 });
    await page.reload();
    await expect(page.getByText(longName).first()).toBeVisible({ timeout: 10_000 });
    const farms = (await (await api(request, "get", "/farms", f.data.accessToken)).json()).data as { name: string }[];
    expect(farms.some((x) => x.name === longName)).toBe(true);
  });

  test("[RES-02] a failed independent dashboard call leaves healthy sections usable; retry works", async ({ page }) => {
    let blocked = true;
    await page.route("**/api/v1/weather**", (route) => (blocked ? route.abort() : route.continue()));
    await login(page, DEMO.farmer);
    await page.goto("/");
    // The rest of Home must stay usable while weather fails.
    await expect(page.locator("#main")).toContainText(/কাজ|Task|ফার্ম|Farm|পরামর্শ|Advis/i, { timeout: 15_000 });
    blocked = false;
    const retry = page.locator("button", { hasText: /রিফ্রেশ|Retry|আবার/i }).first();
    if ((await retry.count()) > 0) {
      await retry.click();
      await expect(page.getByText(/আবহাওয়া তথ্য|Weather as of/).first()).toBeVisible({ timeout: 15_000 });
    }
  });
});
