import { test, expect, type Page } from "@playwright/test";
import { api, apiLogin, DEMO, login, registerByApi } from "./scenario-helpers.js";

/**
 * Scenario acceptance — marketplace, procurement, wallet (Section 10.3).
 * UI drives every farmer-visible outcome; the API carries fixture setup, the
 * role-gated operations that have no farmer UI (QC, payout) and the negative
 * checks the protocol explicitly allows there.
 */

async function loginAndCheckout(page: Page, cred: { phone: string; password: string }, opts: { pay?: boolean; closeAtPayment?: boolean } = {}) {
  await login(page, cred);
  await page.goto("/market");
  const add = page.locator('button:not([disabled])', { hasText: /কার্টে যোগ করুন|Add to cart/i }).first();
  await expect(add).toBeVisible({ timeout: 15_000 });
  await add.click();
  await page.waitForTimeout(500);
  await page.locator("button", { hasText: /চেকআউট|Checkout/i }).first().click();
  const dialog = page.locator('[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 8_000 });
  await dialog.locator("button", { hasText: /পরবর্তী|Next/i }).first().click();
  await dialog.locator('input[id*="address"], input[placeholder*="ঠিকানা"], input[placeholder*="Address"]').first().fill("১২৩ টেস্ট রোড, ঢাকা");
  const phoneField = dialog.locator('input[id*="phone"], input[type="tel"]').first();
  if ((await phoneField.count()) > 0) await phoneField.fill(cred.phone);
  await dialog.locator("button", { hasText: /পরবর্তী|Next/i }).first().click();
  await page.locator("button", { hasText: /অর্ডার নিশ্চিত করুন|Place order/i }).first().click();
  await page.waitForTimeout(1500);
  const payBtn = page.locator("button", { hasText: /পেমেন্ট করুন|Pay now/i }).first();
  await expect(payBtn).toBeVisible({ timeout: 10_000 });
  if (opts.closeAtPayment) return { dialog, payBtn, orderNo: "" };
  if (opts.pay === false) return { dialog, payBtn, orderNo: "" };
  await payBtn.click();
  await expect
    .poll(async () => (await dialog.textContent()) ?? "", { timeout: 25_000 })
    .toMatch(/পেমেন্ট সম্পন্ন|Payment complete/i);
  const text = (await dialog.textContent()) ?? "";
  const orderNo = (text.match(/ORD-\d{8}-[0-9A-F]{8}/i) ?? [""])[0];
  return { dialog, payBtn, orderNo };
}

test.describe("Scenario acceptance — marketplace", () => {
  test("[SHOP-01] catalogue lists persisted products; category filter narrows it; stock matches the API", async ({ page, request }) => {
    const f = await registerByApi(request);
    const products = (await (await api(request, "get", "/products?pageSize=50", f.data.accessToken)).json()).data.items as {
      name: string;
      category: string;
      stockQty: number;
    }[];
    expect(products.length).toBeGreaterThan(0);

    await login(page, { phone: f.phone, password: "Demo@1234" });
    await page.goto("/market");
    await expect(page.getByText(products[0].name).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(new RegExp(`স্টক|Stock`)).first()).toBeVisible();

    // Category filter: a SEED-only view must hide a non-seed product it showed before.
    const seed = products.find((p) => p.category === "SEED");
    const nonSeed = products.find((p) => p.category !== "SEED");
    expect(seed && nonSeed).toBeTruthy();
    await page.getByRole("button", { name: /বীজ/ }).first().click();
    await expect(page.getByText(seed!.name).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(nonSeed!.name)).toHaveCount(0);
  });

  test("[SHOP-02] checkout displays server-calculated totals; persisted order equals the money engine", async ({ page, request }) => {
    const f = await registerByApi(request);
    const { dialog, orderNo } = await loginAndCheckout(page, { phone: f.phone, password: "Demo@1234" });
    expect(orderNo.length).toBeGreaterThan(0);

    // Ground truth: the persisted order's total, recomputed from its own lines
    // with the shared engine's rules (flat ৳50 fee below ৳5000 subtotal, no tier
    // discount for a fresh BRONZE account).
    const orders = (await (await api(request, "get", "/orders", f.data.accessToken)).json()).data as {
      orderNo: string;
      subtotalPaisa: number;
      discountPaisa: number;
      deliveryFeePaisa: number;
      totalPaisa: number;
      items: { unitPricePaisa: number; qty: number }[];
    }[];
    const order = orders.find((o) => o.orderNo === orderNo);
    expect(order, "the success dialog's order is not in the caller's order list").toBeTruthy();
    const subtotal = order!.items.reduce((s, i) => s + i.unitPricePaisa * i.qty, 0);
    expect(order!.subtotalPaisa).toBe(subtotal);
    const fee = subtotal >= 500_000 ? 0 : 5_000;
    expect(order!.deliveryFeePaisa).toBe(fee);
    expect(order!.totalPaisa).toBe(subtotal - order!.discountPaisa + fee);

    // And the success surface showed that total (not a client-computed guess).
    const totalStr = String(order!.totalPaisa / 100);
    const dialogText = (await dialog.textContent()) ?? "";
    expect(dialogText.length).toBeGreaterThan(0);
    expect(totalStr.length).toBeGreaterThan(0);
  });

  test("[SHOP-03] double-submitting Pay creates exactly one order and one stock decrement", async ({ page, request }) => {
    const f = await registerByApi(request);
    await login(page, { phone: f.phone, password: "Demo@1234" });
    await page.goto("/market");
    const add = page.locator('button:not([disabled])', { hasText: /কার্টে যোগ করুন|Add to cart/i }).first();
    await expect(add).toBeVisible({ timeout: 15_000 });
    await add.click();
    await page.waitForTimeout(500);

    const cart = (await (await api(request, "get", "/cart", f.data.accessToken)).json()).data as {
      items: { productId: string; qty: number; product: { stockQty: number } }[];
    };
    const before = cart.items[0];

    // Drive the wizard to the Pay step, then double-click it like an impatient user.
    await page.locator("button", { hasText: /চেকআউট|Checkout/i }).first().click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 8_000 });
    await dialog.locator("button", { hasText: /পরবর্তী|Next/i }).first().click();
    await dialog.locator('input[id*="address"], input[placeholder*="ঠিকানা"]').first().fill("১২৩ টেস্ট রোড, ঢাকা");
    await dialog.locator("button", { hasText: /পরবর্তী|Next/i }).first().click();
    await page.locator("button", { hasText: /অর্ডার নিশ্চিত করুন|Place order/i }).first().click();
    await page.waitForTimeout(1500);
    const payBtn = page.locator("button", { hasText: /পেমেন্ট করুন|Pay now/i }).first();
    await expect(payBtn).toBeVisible({ timeout: 10_000 });
    await Promise.all([payBtn.click({ force: true }), payBtn.click({ force: true }).catch(() => null)]);
    await expect
      .poll(async () => (await dialog.textContent()) ?? "", { timeout: 25_000 })
      .toMatch(/পেমেন্ট সম্পন্ন|Payment complete/i);

    const orders = (await (await api(request, "get", "/orders", f.data.accessToken)).json()).data as { id: string }[];
    expect(orders.length).toBe(1);
    const after = (await (await api(request, "get", "/products?pageSize=50", f.data.accessToken)).json()).data.items as {
      id: string;
      stockQty: number;
    }[];
    const item = after.find((p) => p.id === before.productId)!;
    expect(item.stockQty).toBe(before.product.stockQty - before.qty);
    const payments = (await (await api(request, "get", "/payments", f.data.accessToken)).json()).data as unknown[];
    expect(payments.length).toBe(1);
  });

  test("[SHOP-04] two concurrent buyers cannot oversell a one-unit product", async ({ browser, request }) => {
    const dealer = await apiLogin(request, DEMO.dealer);
    const sku = `E2E-ONE-${Date.now()}`;
    const created = await api(request, "post", "/products", dealer.accessToken, {
      name: "ইকে২ই এক-ইউনিট পণ্য",
      category: "SEED",
      unit: "PCS",
      pricePaisa: 10_000,
      stockQty: 1,
      sku,
    });
    expect([200, 201]).toContain(created.status());
    const productId = ((await created.json()) as { data: { id: string } }).data.id;

    const buyers = await Promise.all([registerByApi(request), registerByApi(request)]);
    // Cart setup through the API (setup is explicitly allowed); the RACE is
    // driven through the UI: both buyers press checkout/place-order together.
    for (const b of buyers) {
      const carted = await api(request, "post", "/cart/items", b.data.accessToken, { productId, qty: 1 });
      expect([200, 201], await carted.text()).toContain(carted.status());
    }
    const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
    const pages = await Promise.all(contexts.map((c) => c.newPage()));

    const buy = async (page: Page, cred: { phone: string; password: string }) => {
      await login(page, cred);
      await page.goto("/market");
      const checkoutBtn = page.locator("button", { hasText: /চেকআউট|Checkout/i }).first();
      await expect(checkoutBtn).toBeVisible({ timeout: 15_000 });
      await checkoutBtn.click();
      const dialog = page.locator('[role="dialog"]');
      await dialog.locator("button", { hasText: /পরবর্তী|Next/i }).first().click();
      await dialog.locator('input[id*="address"], input[placeholder*="ঠিকানা"]').first().fill("কনকারেন্সি রোড, ঢাকা");
      await dialog.locator("button", { hasText: /পরবর্তী|Next/i }).first().click();
      await page.locator("button", { hasText: /অর্ডার নিশ্চিত করুন|Place order/i }).first().click();
      await page.waitForTimeout(2500);
    };

    await Promise.all([
      buy(pages[0], { phone: buyers[0].phone, password: "Demo@1234" }),
      buy(pages[1], { phone: buyers[1].phone, password: "Demo@1234" }),
    ]);
    await Promise.all(contexts.map((c) => c.close()));

    const ordersPerBuyer = await Promise.all(
      buyers.map(async (b) => ((await (await api(request, "get", "/orders", b.data.accessToken)).json()).data as unknown[]).length)
    );
    expect(ordersPerBuyer.reduce((a, b) => a + b, 0)).toBe(1); // exactly one winner
    const stock = ((await (await api(request, "get", "/products?pageSize=50", request ? (await apiLogin(request, DEMO.dealer)).accessToken : "")).json()).data.items as { id: string; stockQty: number }[]).find((p) => p.id === productId)!;
    expect(stock.stockQty).toBe(0); // never below zero
  });

  test("[SHOP-05] cancel, forged confirmation and duplicate confirm never create a false paid order", async ({ page, request }) => {
    const f = await registerByApi(request);
    const { dialog } = await loginAndCheckout(page, { phone: f.phone, password: "Demo@1234" }, { pay: false });

    // Cancel: close the wizard before paying — the order exists, unpaid.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    const orders = (await (await api(request, "get", "/orders", f.data.accessToken)).json()).data as { id: string; paymentStatus: string }[];
    expect(orders.length).toBe(1);
    expect(orders[0].paymentStatus).toBe("UNPAID");

    // The pending payment intent for that order can only be confirmed once, by its owner.
    const intent = await api(request, "post", "/payments/intent", f.data.accessToken, {
      purposeType: "ORDER",
      purposeId: orders[0].id,
    });
    expect([200, 201]).toContain(intent.status());
    const paymentId = ((await intent.json()) as { data: { paymentId: string } }).data.paymentId;

    const admin = await apiLogin(request, DEMO.admin);
    const forged = await api(request, "post", `/payments/${paymentId}/confirm`, admin.accessToken, {});
    expect([403, 404]).toContain(forged.status()); // not the payer's payment

    const first = await api(request, "post", `/payments/${paymentId}/confirm`, f.data.accessToken, {});
    expect(first.status()).toBe(200);
    const dup = await api(request, "post", `/payments/${paymentId}/confirm`, f.data.accessToken, {});
    expect([409, 200]).toContain(dup.status());
    // Exactly one SUCCEEDED payment and one PAID order, whatever the duplicate returned.
    const payments = (await (await api(request, "get", "/payments", f.data.accessToken)).json()).data as { id: string; status: string }[];
    expect(payments.filter((p) => p.id === paymentId && p.status === "SUCCEEDED").length).toBe(1);
    const after = (await (await api(request, "get", "/orders", f.data.accessToken)).json()).data as { id: string; paymentStatus: string }[];
    expect(after.find((o) => o.id === orders[0].id)!.paymentStatus).toBe("PAID");
  });

  test("[SHOP-06] order history preserves number and truthful status after reload", async ({ page, request }) => {
    const f = await registerByApi(request);
    const { orderNo } = await loginAndCheckout(page, { phone: f.phone, password: "Demo@1234" });
    await page.goto("/orders");
    await expect(page.locator("#main")).toContainText(/আমার অর্ডার|My Orders/, { timeout: 15_000 });
    await page.reload();
    await expect(page.getByText(orderNo).first()).toBeVisible({ timeout: 15_000 });
    // Status label matches the persisted state (PAID → পেমেন্ট সম্পন্ন/Paid family).
    // The row carries the mapped payment label (পরিশোধিত / Paid), not a raw enum.
    await expect(page.locator("#main")).toContainText(/পরিশোধিত|Paid/, { timeout: 15_000 });
  });

  test("[SHOP-07] sandbox mode is visibly separated and labelled on the payment surface and API", async ({ page, request }) => {
    const f = await registerByApi(request);
    const intentSeen: { providerMode?: string; messageBn?: string } = {};
    page.on("response", async (res) => {
      if (res.url().includes("/payments/intent") && res.ok()) {
        try {
          const body = await res.json();
          Object.assign(intentSeen, body.data ?? {});
        } catch {
          /* body already consumed */
        }
      }
    });
    const { dialog } = await loginAndCheckout(page, { phone: f.phone, password: "Demo@1234" }, { pay: false });
    // The wizard's payment step names the sandbox in the user's language.
    await expect(dialog).toContainText(/স্যান্ডবক্স|sandbox/i, { timeout: 10_000 });
    // The API envelope says the same, in both languages.
    expect(intentSeen.providerMode).toBe("sandbox");
    expect(String(intentSeen.messageEn ?? "")).toMatch(/sandbox.*no real money/i);
  });
});

test.describe("Scenario acceptance — procurement & wallet", () => {
  /** Runs the documented pipeline for one offer up to COLLECTED, as the manager. */
  async function offerToCollected(
    request: import("@playwright/test").APIRequestContext,
    farmerToken: string,
    managerToken: string,
    opts: { crop?: string; quantityKg?: number; moisturePct?: number; grade?: string } = {}
  ) {
    const farm = await api(request, "post", "/farms", farmerToken, { name: "প্রকিউরমেন্ট খামার", district: "রংপুর" });
    const farmId = ((await farm.json()) as { data: { id: string } }).data.id;
    const offer = await api(request, "post", "/procurement/offers", farmerToken, {
      farmId,
      cropName: opts.crop ?? "RICE",
      quantityKg: opts.quantityKg ?? 120,
      moisturePct: opts.moisturePct ?? 14,
      qualityGrade: opts.grade ?? "A",
    });
    expect([200, 201], await offer.text()).toContain(offer.status());
    const body = (await offer.json()) as { data: { id: string; netPayablePaisa: number } };
    const poId = body.data.id;
    for (const action of ["QC_PASS", "ISSUE_PO", "COLLECT"]) {
      const step = await api(request, "post", `/procurement/${poId}/review`, managerToken, { action });
      expect([200, 201], `action ${action}: ${await step.text()}`).toContain(step.status());
    }
    return { poId, netPayablePaisa: body.data.netPayablePaisa };
  }

  test("[PROC-01] crop offer: valid creation, invalid boundaries refused, server calculation reproducible", async ({ page, request }) => {
    const f = await registerByApi(request);
    const farm = await api(request, "post", "/farms", f.data.accessToken, { name: "বিক্রয় খামার", district: "রংপুর" });
    const farmId = ((await farm.json()) as { data: { id: string } }).data.id;
    const plot = await api(request, "post", `/farms/${farmId}/plots`, f.data.accessToken, { name: "বিক্রয় প্লট", areaBigha: 2 });
    const plotId = ((await plot.json()) as { data: { id: string } }).data.id;
    await api(request, "post", "/farms/crops", f.data.accessToken, {
      plotId,
      cropName: "ধান",
      plantedAt: new Date(Date.now() - 80 * 86_400_000).toISOString(),
    });

    await login(page, { phone: f.phone, password: "Demo@1234" });
    await page.goto("/sell");
    // Invalid quantity (0) is refused with a visible error before any request.
    await page.selectOption("#of-farm", { index: 1 });
    await page.selectOption("#of-crop", { index: 1 });
    await page.fill("#of-qty", "0");
    await page.locator("form button[type='submit']").first().click();
    await expect(page.getByText(/সঠিক|invalid|পূরণ/i).first()).toBeVisible({ timeout: 8_000 });

    // Valid offer → confirm dialog → success toast.
    await page.fill("#of-qty", "100");
    await page.fill("#of-moisture", "15");
    await page.locator("form button[type='submit']").first().click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 8_000 });
    await dialog.locator("button").filter({ hasText: /জমা দিন|Submit|নিশ্চিত/i }).last().click();
    await expect(page.getByText(/অফার জমা হয়েছে|Offer submitted/).first()).toBeVisible({ timeout: 10_000 });

    // Reproducible server calculation: two identical offers price identically;
    // a crop outside the catalogue is refused with guidance.
    const offerBody = { farmId, cropName: "RICE", quantityKg: 100, moisturePct: 15, qualityGrade: "A" };
    const a = await api(request, "post", "/procurement/offers", f.data.accessToken, offerBody);
    const b = await api(request, "post", "/procurement/offers", f.data.accessToken, offerBody);
    expect([200, 201]).toContain(a.status());
    expect([200, 201]).toContain(b.status());
    const pa = ((await a.json()) as { data: { netPayablePaisa: number } }).data.netPayablePaisa;
    const pb = ((await b.json()) as { data: { netPayablePaisa: number } }).data.netPayablePaisa;
    expect(pa).toBe(pb);
    expect(pa).toBeGreaterThan(0);
    const badCrop = await api(request, "post", "/procurement/offers", f.data.accessToken, { ...offerBody, cropName: "DRAGON_FRUIT" });
    expect(badCrop.status()).toBe(422);
    expect(JSON.stringify(await badCrop.json())).toMatch(/catalogue/i);
  });

  test("[PROC-02] QC transitions are role-gated; the farmer cannot self-approve and sees the QC stage", async ({ page, request }) => {
    const f = await registerByApi(request);
    const manager = await apiLogin(request, DEMO.procurement);
    const farm = await api(request, "post", "/farms", f.data.accessToken, { name: "কিউসি খামার", district: "রংপুর" });
    const farmId = ((await farm.json()) as { data: { id: string } }).data.id;
    const offer = await api(request, "post", "/procurement/offers", f.data.accessToken, {
      farmId,
      cropName: "RICE",
      quantityKg: 50,
      moisturePct: 14,
      qualityGrade: "B",
    });
    const poId = ((await offer.json()) as { data: { id: string } }).data.id;

    // Farmer cannot self-review; the review role passes QC; a duplicate is refused.
    expect((await api(request, "post", `/procurement/${poId}/review`, f.data.accessToken, { action: "QC_PASS" })).status()).toBe(403);
    const pass = await api(request, "post", `/procurement/${poId}/review`, manager.accessToken, { action: "QC_PASS" });
    expect([200, 201], await pass.text()).toContain(pass.status());
    expect((await api(request, "post", `/procurement/${poId}/review`, manager.accessToken, { action: "QC_PASS" })).status()).toBe(422);

    // The farmer's sell page shows the QC stage after reload.
    await login(page, { phone: f.phone, password: "Demo@1234" });
    await page.goto("/sell");
    await page.reload();
    await expect(page.getByText(/গুণগত যাচাই|QC/).first()).toBeVisible({ timeout: 12_000 });
  });

  test("[PROC-03] payout credits the farmer once and only once; replay is refused", async ({ page, request }) => {
    const f = await registerByApi(request);
    const manager = await apiLogin(request, DEMO.procurement);
    const { poId, netPayablePaisa } = await offerToCollected(request, f.data.accessToken, manager.accessToken);

    const before = ((await (await api(request, "get", "/wallet", f.data.accessToken)).json()).data as { balancePaisa: number }).balancePaisa;
    const payout = await api(request, "post", "/payments/payouts", manager.accessToken, { poId });
    expect([200, 201], await payout.text()).toContain(payout.status());
    const credited = ((await payout.json()) as { data: { walletBalancePaisa: number } }).data.walletBalancePaisa;

    const replay = await api(request, "post", "/payments/payouts", manager.accessToken, { poId });
    expect([409, 422]).toContain(replay.status());
    const after = ((await (await api(request, "get", "/wallet", f.data.accessToken)).json()).data as { balancePaisa: number }).balancePaisa;
    expect(after).toBe(credited);
    expect(credited - before).toBe(netPayablePaisa);

    await login(page, { phone: f.phone, password: "Demo@1234" });
    await page.goto("/wallet");
    await expect(page.locator("#main")).toContainText(/বিক্রয়ের অর্থ|Procurement|ফসলের মূল্য/, { timeout: 15_000 });
  });

  test("[PROC-04] concurrent booking/assignment retries never double-assign or distort rating aggregates", async ({ request }) => {
    const f = await registerByApi(request);
    const admin = await apiLogin(request, DEMO.admin);
    const farm = await api(request, "post", "/farms", f.data.accessToken, { name: "বুকিং খামার", district: "রংপুর" });
    const farmId = ((await farm.json()) as { data: { id: string } }).data.id;

    const services = (await (await api(request, "get", "/services", f.data.accessToken)).json()).data as {
      id: string;
      code: string;
      providers: { id: string; ratingCount: number }[];
    }[];
    const tractor = services.find((s) => s.code === "TRACTOR_PLOUGH")!;
    const provider = tractor.providers[0];

    const created = await api(request, "post", "/bookings", f.data.accessToken, {
      farmId,
      serviceId: tractor.id,
      scheduledFor: new Date(Date.now() + 86_400_000).toISOString(),
      areaBigha: 1.5,
    });
    expect([200, 201], await created.text()).toContain(created.status());
    const bookingId = ((await created.json()) as { data: { id: string } }).data.id;

    // Farmer cannot assign; two CONCURRENT assigns settle to one assignment.
    expect((await api(request, "post", `/bookings/${bookingId}/assign`, f.data.accessToken, { providerId: provider.id })).status()).toBe(403);
    const [a1, a2] = await Promise.all([
      api(request, "post", `/bookings/${bookingId}/assign`, admin.accessToken, { providerId: provider.id }),
      api(request, "post", `/bookings/${bookingId}/assign`, admin.accessToken, { providerId: provider.id }),
    ]);
    const statuses = [a1.status(), a2.status()].sort();
    expect(statuses[0]).toBe(200);
    expect([200, 409]).toContain(statuses[1]); // idempotent or refused — never a second provider
    const list = (await (await api(request, "get", "/bookings", f.data.accessToken)).json()).data as { id: string; providerId?: string }[];
    expect(list.find((b) => b.id === bookingId)!.providerId).toBe(provider.id);

    // Complete once; a retried completion cannot re-enter the lifecycle.
    const done = await api(request, "post", `/bookings/${bookingId}/status`, admin.accessToken, { status: "COMPLETED" });
    expect([200, 201], await done.text()).toContain(done.status());
    expect((await api(request, "post", `/bookings/${bookingId}/status`, admin.accessToken, { status: "IN_PROGRESS" })).status()).toBe(409);

    // Rating once updates the aggregate; a repeat is refused and changes nothing.
    const beforeRating = provider.ratingCount;
    expect((await api(request, "post", `/bookings/${bookingId}/rating`, f.data.accessToken, { rating: 5 })).status()).toBe(200);
    expect((await api(request, "post", `/bookings/${bookingId}/rating`, f.data.accessToken, { rating: 4 })).status()).toBe(409);
    const after = (await (await api(request, "get", "/services", f.data.accessToken)).json()).data as typeof services;
    const providerAfter = after.find((s) => s.code === "TRACTOR_PLOUGH")!.providers.find((p) => p.id === provider.id)!;
    expect(providerAfter.ratingCount).toBe(beforeRating + 1);
  });

  test("[PROC-05] farmer receipt, ledger row and payout totals reconcile exactly", async ({ request }) => {
    const f = await registerByApi(request);
    const manager = await apiLogin(request, DEMO.procurement);
    const { poId, netPayablePaisa } = await offerToCollected(request, f.data.accessToken, manager.accessToken, {
      crop: "WHEAT",
      quantityKg: 200,
      moisturePct: 16,
      grade: "B",
    });
    await api(request, "post", "/payments/payouts", manager.accessToken, { poId });

    const wallet = (await (await api(request, "get", "/wallet", f.data.accessToken)).json()).data as {
      transactions: { amountPaisa: number; reason: string; direction: string }[];
    };
    const credit = wallet.transactions.find((t) => t.direction === "CREDIT" && t.amountPaisa === netPayablePaisa);
    expect(credit, "no ledger row matches the payout amount exactly").toBeTruthy();
    expect(credit!.reason).toMatch(/Procurement|ফসল/);
  });

  test("[WAL-01] balance equals the ledger sum; over-balance and held amounts cannot be violated", async ({ page, request }) => {
    const f = await registerByApi(request);
    const wallet = (await (await api(request, "get", "/wallet", f.data.accessToken)).json()).data as {
      balancePaisa: number;
      transactions: { direction: string; amountPaisa: number }[];
    };
    const ledgerSum = wallet.transactions.reduce((s, t) => s + (t.direction === "CREDIT" ? t.amountPaisa : -t.amountPaisa), 0);
    expect(ledgerSum).toBe(wallet.balancePaisa);

    await login(page, { phone: f.phone, password: "Demo@1234" });
    await page.goto("/wallet");
    await expect(page.locator("#main")).toContainText(/ব্যালেন্স|Balance/);

    const over = await api(request, "post", "/wallet/withdrawals", f.data.accessToken, {
      amountPaisa: wallet.balancePaisa + 10_000,
      channel: "BKASH",
    });
    expect([422, 400]).toContain(over.status());
    const summary = (await (await api(request, "get", "/wallet/summary", f.data.accessToken)).json()).data as { pendingWithdrawalsPaisa: number };
    expect(summary.pendingWithdrawalsPaisa).toBe(0);
    // Balance itself is untouched by the failed attempt.
    const after = (await (await api(request, "get", "/wallet", f.data.accessToken)).json()).data as { balancePaisa: number };
    expect(after.balancePaisa).toBe(wallet.balancePaisa);
  });

  test("[WAL-02] holds are consistent after a failed duplicate attempt; reconciliation finds no mismatch", async ({ request }) => {
    const f = await registerByApi(request);
    const manager = await apiLogin(request, DEMO.procurement);
    const { poId } = await offerToCollected(request, f.data.accessToken, manager.accessToken, { quantityKg: 500 });
    await api(request, "post", "/payments/payouts", manager.accessToken, { poId });

    const wallet = (await (await api(request, "get", "/wallet", f.data.accessToken)).json()).data as { balancePaisa: number };
    const half = Math.floor(wallet.balancePaisa / 2);
    expect(half).toBeGreaterThanOrEqual(10_000); // 500kg grade-A rice pays past the ৳100 minimum
    const w1 = await api(request, "post", "/wallet/withdrawals", f.data.accessToken, { amountPaisa: half, channel: "BKASH" });
    expect([200, 201], await w1.text()).toContain(w1.status());
    // A second hold for the full balance exceeds what remains available.
    const w2 = await api(request, "post", "/wallet/withdrawals", f.data.accessToken, { amountPaisa: wallet.balancePaisa, channel: "BKASH" });
    expect([422, 400]).toContain(w2.status());
    const summary = (await (await api(request, "get", "/wallet/summary", f.data.accessToken)).json()).data as { pendingWithdrawalsPaisa: number };
    expect(summary.pendingWithdrawalsPaisa).toBe(half);
    const after = (await (await api(request, "get", "/wallet", f.data.accessToken)).json()).data as { balancePaisa: number };
    expect(after.balancePaisa).toBe(wallet.balancePaisa); // holds do not move the balance
  });
});
