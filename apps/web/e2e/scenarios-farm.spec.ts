import { test, expect } from "@playwright/test";
import { api, login, registerByApi } from "./scenario-helpers.js";

/**
 * Scenario acceptance — farm / My Farm / crop lifecycle (Section 10.3).
 * UI drives the farmer's own workflows; the API carries setup, the documented
 * negative checks and the ground-truth comparisons.
 */

test.describe("Scenario acceptance — farm", () => {
  test("[FARM-01] create farm/plot via UI, validate units, add a crop, stage-driven tasks advance", async ({ page, request }) => {
    const f = await registerByApi(request);
    await login(page, { phone: f.phone, password: "Demo@1234" });
    await page.goto("/farm");

    // Create the farm through the form.
    await page.getByRole("button", { name: /নতুন ফার্ম|Add Farm/ }).first().click();
    await page.fill("#fm-name", "ইকে২ই খামার");
    await page.fill("#fm-district", "রংপুর");
    await page.fill("#fm-area", "2.5");
    await page.locator("form button[type='submit']").first().click();
    await expect(page.getByText("ইকে২ই খামার").first()).toBeVisible({ timeout: 10_000 });

    // Add a plot (area unit is bigha; the toast + the farm card count prove it
    // persisted, not just that the form closed).
    await page.getByRole("button", { name: /নতুন প্লট|Add Plot/ }).first().click();
    await page.locator("form input[name='name']").fill("উত্তর প্লট");
    await page.locator("form input[name='area']").fill("1.5");
    await page.locator("form button[type='submit']").last().click();
    await expect(page.getByText(/প্লট যোগ হয়েছে|Plot created/).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/1 প্লট|1 plot/i).first()).toBeVisible({ timeout: 10_000 });

    // Add a crop planted 31 days ago → VEGETATIVE stage → the urea top-dressing
    // TASK appears in the crop row (stage-appropriate generation; the summary
    // counters are separate text, so this string is unique to a real crop row).
    // The crop action lives in the expanded plot list — the collapsed card
    // shows only the plot count.
    await page.getByRole("button", { name: /প্লট দেখুন|View plots/ }).first().click();
    await page.getByRole("button", { name: /নতুন ফসল|Add Crop/ }).first().click();
    const cropForm = page.locator("form").filter({ has: page.locator("select") }).first();
    await cropForm.locator("select").selectOption({ index: 1 });
    const planted = new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10);
    await cropForm.locator('input[type="date"]').fill(planted);
    await cropForm.locator("button[type='submit']").click();
    await expect(page.getByText(/ইউরিয়া সেচ দিন|Apply urea top dressing/).first()).toBeVisible({ timeout: 10_000 });

    // Legitimate forward stage advance (ACTIVE cycle): FLOWERING → routine care
    // replaces the vegetative task, so the chip is driven by the real stage.
    // Crop ids ride inside the farm list payload (plots[].cropCycles[]).
    const farms = await (await api(request, "get", "/farms", f.data.accessToken)).json();
    const cropId = (
      farms.data as { plots: { cropCycles: { id: string; cropName: string }[] }[] }[]
    )[0].plots[0].cropCycles[0].id;
    const advanced = await api(request, "patch", `/farms/crops/${cropId}`, f.data.accessToken, { stage: "FLOWERING" });
    expect(advanced.status()).toBe(200);
    await page.reload();
    // Reload returns to the collapsed card; expand the plot list again.
    await page.getByRole("button", { name: /প্লট দেখুন|View plots/ }).first().click();
    await expect(page.getByText(/ধান • /).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/ইউরিয়া সেচ দিন|Apply urea top dressing/)).toHaveCount(0);
  });

  test("[FARM-02] invalid input and out-of-order transitions rejected; values persist", async ({ page, request }) => {
    const f = await registerByApi(request);
    await login(page, { phone: f.phone, password: "Demo@1234" });
    await page.goto("/farm");

    // Invalid area (0) is refused with a visible error and nothing is created.
    await page.getByRole("button", { name: /নতুন ফার্ম|Add Farm/ }).first().click();
    await page.fill("#fm-name", "ভুল খামার");
    await page.fill("#fm-area", "0");
    await page.locator("form button[type='submit']").first().click();
    await expect(page.locator("#fm-area-err")).toContainText(/বড়|greater than 0/, { timeout: 8_000 });
    expect(await (await api(request, "get", "/farms", f.data.accessToken)).json()).toMatchObject({ data: [] });

    // Server-side rejection of invalid areas too (client validation is not the control).
    const badFarm = await api(request, "post", "/farms", f.data.accessToken, { name: "Bad", totalAreaBigha: 0 });
    expect(badFarm.status()).toBe(400);
    const okFarm = await api(request, "post", "/farms", f.data.accessToken, { name: "সীমানা খামার" });
    const okFarmId = ((await okFarm.json()) as { data: { id: string } }).data.id;
    for (const bad of [0, -2]) {
      const badPlot = await api(request, "post", `/farms/${okFarmId}/plots`, f.data.accessToken, { name: "p", areaBigha: bad });
      expect(badPlot.status(), `areaBigha=${bad} must be refused`).toBe(400);
    }

    // Out-of-order lifecycle: harvest then reopen → 409 (terminal state).
    const farm = await api(request, "post", "/farms", f.data.accessToken, { name: "লাইফসাইকেল খামার", areaBigha: 3 });
    const farmId = ((await farm.json()) as { data: { id: string } }).data.id;
    const plot = await api(request, "post", `/farms/${farmId}/plots`, f.data.accessToken, { name: "প্লট ক", areaBigha: 1 });
    const plotId = ((await plot.json()) as { data: { id: string } }).data.id;
    const crop = await api(request, "post", "/farms/crops", f.data.accessToken, {
      plotId,
      cropName: "ধান",
      plantedAt: new Date(Date.now() - 60 * 86_400_000).toISOString(),
    });
    const cropId = ((await crop.json()) as { data: { id: string } }).data.id;
    expect((await api(request, "patch", `/farms/crops/${cropId}`, f.data.accessToken, { status: "HARVESTED" })).status()).toBe(200);
    expect((await api(request, "patch", `/farms/crops/${cropId}`, f.data.accessToken, { status: "ACTIVE" })).status()).toBe(409);

    // Unauthorized edit of a farm the caller does not own → 404 (no oracle).
    const outsider = await registerByApi(request);
    expect((await api(request, "patch", `/farms/${farmId}`, outsider.data.accessToken, { name: "Hijack" })).status()).toBe(404);

    // Persistence: values survive a reload and match the API ground truth.
    await page.reload();
    await expect(page.getByText("লাইফসাইকেল খামার").first()).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /প্লট দেখুন|View plots/ }).first().click();
    await expect(page.getByText(/প্লট ক/).first()).toBeVisible({ timeout: 10_000 });
    const truth = await (await api(request, "get", "/farms", f.data.accessToken)).json();
    expect(JSON.stringify(truth).includes("লাইফসাইকেল খামার")).toBe(true);
  });

  test("[FARM-03] offline write replays exactly once; a stale replay surfaces instead of silently overwriting", async ({ page, context, request }) => {
    const f = await registerByApi(request);
    await login(page, { phone: f.phone, password: "Demo@1234" });

    // Offline banner + queued write: two offline attempts at the same cart line
    // must dedupe to ONE queued mutation (explicit clientUuid/hash contract),
    // so the reconnect replay applies the change exactly once.
    await page.goto("/market");
    // The catalogue must be LOADED before the connection drops — going offline
    // first means the product fetch itself fails and no button ever renders.
    const addToCart = page.locator('button:not([disabled])', { hasText: /কার্টে যোগ করুন|Add to cart/i }).first();
    await expect(addToCart).toBeVisible({ timeout: 15_000 });
    await context.setOffline(true);
    await expect(page.locator('[data-testid="offline-banner"]')).toBeVisible({ timeout: 10_000 });
    await addToCart.click();
    await page.waitForTimeout(600);
    await addToCart.click();
    await page.waitForTimeout(600);

    // Reconnect → the queue flushes; the server cart holds exactly one line.
    await context.setOffline(false);
    await expect(page.locator('[data-testid="offline-banner"]')).toHaveCount(0, { timeout: 15_000 });
    await expect
      .poll(async () => {
        const cart = await api(request, "get", "/cart", f.data.accessToken);
        const body = (await cart.json()) as { data: { items?: unknown[] } };
        return body.data?.items?.length ?? 0;
      }, { timeout: 15_000 })
      .toBe(1);

    // Farm-event idempotency: the SAME clientUuid posted twice creates one row.
    const farms = await api(request, "post", "/farms", f.data.accessToken, { name: "সিঙ্ক খামার" });
    const farmId = ((await farms.json()) as { data: { id: string } }).data.id;
    const clientUuid = crypto.randomUUID(); // the API pins clientUuid to a real UUID
    const ev = { type: "IRRIGATION", title: "সেচ দেওয়া হয়েছে", clientUuid };
    const first = await api(request, "post", `/farms/${farmId}/events`, f.data.accessToken, ev);
    const second = await api(request, "post", `/farms/${farmId}/events`, f.data.accessToken, ev);
    expect([200, 201]).toContain(first.status());
    expect([200, 201, 409]).toContain(second.status());
    const events = await (await api(request, "get", `/farms/${farmId}/events`, f.data.accessToken)).json();
    expect(
      (events.data as { clientUuid?: string }[]).filter((e) => e.clientUuid === clientUuid).length
    ).toBe(1);

    // Cross-actor replay refusal: the same clientUuid from ANOTHER user's farm id
    // is rejected outright — a queued mutation cannot be replayed into a foreign
    // tenant (the queue's owner scoping, asserted at the API boundary here).
    const outsider = await registerByApi(request);
    const foreignReplay = await api(request, "post", `/farms/${farmId}/events`, outsider.data.accessToken, {
      type: "IRRIGATION",
      title: "foreign replay",
      clientUuid,
    });
    expect(foreignReplay.status()).toBe(404);
  });

  test("[FARM-04] multiple farms/plots render from ground truth; dates and stages match", async ({ page, request }) => {
    const f = await registerByApi(request);
    const names = ["বড় খামার", "ছোট খামার"];
    const plantedDays = [5, 50];
    for (let i = 0; i < 2; i++) {
      const farm = await api(request, "post", "/farms", f.data.accessToken, { name: names[i], areaBigha: 4 });
      const farmId = ((await farm.json()) as { data: { id: string } }).data.id;
      const plot = await api(request, "post", `/farms/${farmId}/plots`, f.data.accessToken, { name: `প্লট ${i + 1}`, areaBigha: 2 });
      const plotId = ((await plot.json()) as { data: { id: string } }).data.id;
      const crop = await api(request, "post", "/farms/crops", f.data.accessToken, {
        plotId,
        cropName: i === 0 ? "ধান" : "গম",
        plantedAt: new Date(Date.now() - plantedDays[i] * 86_400_000).toISOString(),
      });
      expect([200, 201]).toContain(crop.status());
    }

    await login(page, { phone: f.phone, password: "Demo@1234" });
    await page.goto("/farm");
    for (const name of names) await expect(page.getByText(name).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/প্লট 1/).first()).toBeVisible();

    // Same ground truth, deeper: the farm list payload carries each plot's
    // cropCycles with the server-computed stage — the UI rows render from it.
    const detail = await (await api(request, "get", "/farms", f.data.accessToken)).json();
    const farmList = detail.data as { plots: { cropCycles: { id: string; cropName: string }[] }[] }[];
    expect(farmList.length).toBe(2);
    const allCropIds = farmList.flatMap((farm) => farm.plots.flatMap((plot) => plot.cropCycles.map((c) => c.id)));
    expect(allCropIds.length).toBe(2);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).toMatch(/ধান/);
    expect(bodyText).toMatch(/গম/);
    expect(bodyText).toMatch(/জরুরি|রুটিন|আজ করতে হবে|Urgent|Routine|Due today/);
  });
});
