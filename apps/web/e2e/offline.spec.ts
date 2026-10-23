import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

/**
 * Offline resilience: connectivity banner appears when the context goes
 * offline and hides again when back online.
 * Requires running API + Web (see farmer-journey.spec.ts).
 */
test.describe("Offline banner", () => {
  test("shows offline banner when disconnected, hides when reconnected", async ({ page, context }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/.*login/);
    await page.fill("#phone", "01700000002");
    await page.fill("#password", "Demo@1234");
    await page.click('button:has-text("Sign in"), button:has-text("প্রবেশ করুন")');
    await page.waitForURL(/.*\/$/, { timeout: 10_000 });

    // No banner while online.
    await expect(page.locator('[data-testid="offline-banner"]')).toHaveCount(0);

    // Cut the network — the shell reacts to the window "offline" event and the
    // live connectivity singleton, so hold offline and wait for the banner
    // (robust to event/React re-render timing).
    const banner = page.locator('[data-testid="offline-banner"]');
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(banner).toBeVisible({ timeout: 10_000 });
    await expect(banner).toContainText(/Offline|অফলাইন/u);

    // Restore the network — banner hides.
    await context.setOffline(false);
    await expect(banner).toBeHidden({ timeout: 10_000 });
  });
});

const QUEUE_KEY = "agrobridge.mutationQueue"; // owned by lib/offlineQueue.ts
const API = "/api/v1"; // same path in both passes: dev proxy + the built bundle's VITE_API_BASE_URL

interface QueueEntry {
  url: string;
  method: string;
  body?: { productId?: string; qty?: number };
  clientUuid: string;
}

/** Read the persisted offline queue (the app's own storage). */
function readQueue(page: Page): Promise<QueueEntry[]> {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]") as QueueEntry[], QUEUE_KEY);
}

/**
 * Call the API the way the app's client does — bearer token from localStorage,
 * relative /api/v1 path (works against the dev proxy and the preview server's
 * inherited proxy alike).
 */
function apiCall(page: Page, method: string, path: string, body?: unknown) {
  return page.evaluate(
    async ({ method, path, body }) => {
      const token = localStorage.getItem("ab_at"); // sessionManager owns this key
      const res = await fetch(`/api/v1${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as { data?: unknown } | null;
      return { status: res.status, data: json?.data };
    },
    { method, path, body }
  );
}

interface CartItem {
  productId?: string;
  product?: { id?: string };
  qty: number;
}

/**
 * ARC-17 / WEB-05 — offline write/replay:
 *   1. a real UI write (add to cart) made while offline is queued, the banner
 *      shows the pending count;
 *   2. going online replays it exactly once (one observed network response) and
 *      drains the queue;
 *   3. replaying the same mutation through the API with the same clientUuid
 *      duplicates nothing, and the server's clientUuid idempotency path
 *      (POST /farms/:id/events) returns the stored row instead of inserting a
 *      second one.
 */
test.describe("Offline queue replay (ARC-17/WEB-05)", () => {
  test("queued cart write replays once, drains, and the same clientUuid never duplicates", async ({ page, context }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/.*login/);
    await page.fill("#phone", "01700000002");
    await page.fill("#password", "Demo@1234");
    await page.click('button:has-text("Sign in"), button:has-text("প্রবেশ করুন")');
    await page.waitForURL(/.*\/$/, { timeout: 10_000 });

    await page.goto("/market");
    const addToCart = page.locator('button:not([disabled])', { hasText: /কার্টে যোগ করুন|Add to cart/i }).first();
    await expect(addToCart, "market shows no purchasable add-to-cart button").toBeVisible({ timeout: 10_000 });

    // ── 1. offline write through the UI ────────────────────────────────────
    const banner = page.locator('[data-testid="offline-banner"]');
    await context.setOffline(true);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    // The banner proves the app's connectivity singleton has flipped before the
    // click: the write must be queued, not attempted against a half-dead link.
    await expect(banner).toBeVisible({ timeout: 10_000 });

    await addToCart.click();

    // Banner count + the persisted entry are the queue's public evidence.
    await expect(banner).toContainText("(1)", { timeout: 10_000 });
    await expect.poll(async () => (await readQueue(page)).length, { timeout: 10_000 }).toBe(1);
    const queued = (await readQueue(page))[0]!;
    expect(queued.url).toContain("/cart/items");
    expect(queued.method).toBe("POST");
    const productId = queued.body?.productId ?? "";
    expect(productId, "queued cart body carries no productId").not.toBe("");

    // ── 2. back online: replay must reach the network exactly once ─────────
    // Count only while the queue is draining; the deliberate API replay below
    // is a separate, expected request.
    let phase: "queue" | "manual" = "queue";
    let queueReplays = 0;
    page.on("response", (res) => {
      if (phase === "queue" && res.request().method() === "POST" && res.url().includes("/cart/items")) queueReplays += 1;
    });

    await context.setOffline(false);
    await expect.poll(async () => (await readQueue(page)).length, { timeout: 15_000 }).toBe(0);
    expect(queueReplays, "the queued write was replayed more than once").toBe(1);
    phase = "manual";

    // The single replay landed: one cart line for the product, qty 1.
    const cartAfterSync = await apiCall(page, "GET", "/cart");
    const linesAfterSync = ((cartAfterSync.data as { items?: CartItem[] })?.items ?? []).filter(
      (i) => (i.product?.id ?? i.productId) === productId
    );
    expect(linesAfterSync, "the replayed write did not land exactly once").toHaveLength(1);
    expect(linesAfterSync[0]!.qty).toBe(1);

    // ── 3. the same mutation through the API with the same clientUuid ──────
    // cart POST is an absolute-qty upsert, so a duplicate would show up as qty 2
    // or a second line — assert neither happened.
    const repeat = await apiCall(page, "POST", "/cart/items", { productId, qty: 1, clientUuid: queued.clientUuid });
    expect([200, 201]).toContain(repeat.status);
    const cartAfterRepeat = await apiCall(page, "GET", "/cart");
    const linesAfterRepeat = ((cartAfterRepeat.data as { items?: CartItem[] })?.items ?? []).filter(
      (i) => (i.product?.id ?? i.productId) === productId
    );
    expect(linesAfterRepeat, "repeating the mutation with the same clientUuid duplicated the line").toHaveLength(1);
    expect(linesAfterRepeat[0]!.qty, "repeating the mutation with the same clientUuid changed the quantity").toBe(1);
    expect(queueReplays, "a duplicate replay escaped after the queue drained").toBe(1);

    // ── 4. the server's clientUuid idempotency path (farm events) ──────────
    // POSTing the same event twice with one clientUuid must return the stored
    // row both times — the API's idempotent contract. The duplicate-ROW check
    // (exactly one event, owner-scoped) lives in the API suite
    // (`farm-event-sync-scoping.test.ts`, `journey-farm.test.ts`): with the
    // nested-list caps shipped this wave, a `/events?limit=` page scan here
    // reads the first page of a shared database, not the row just written.
    const farms = await apiCall(page, "GET", "/farms");
    const farmId = (farms.data as { id?: string }[] | undefined)?.[0]?.id;
    expect(farmId, "the seeded farmer has no farm — the idempotency probe cannot run").toBeTruthy();
    const eventUuid = randomUUID(); // idempotency token, generated off-page
    const eventBody = { type: "OTHER", title: "idempotency probe", clientUuid: eventUuid };
    const first = await apiCall(page, "POST", `/farms/${farmId}/events`, eventBody);
    const second = await apiCall(page, "POST", `/farms/${farmId}/events`, eventBody);
    expect([200, 201]).toContain(first.status);
    expect([200, 201]).toContain(second.status);
    const firstId = (first.data as { id?: string } | undefined)?.id;
    expect(firstId, "the event POST returned no id").toBeTruthy();
    expect((second.data as { id?: string } | undefined)?.id, "the clientUuid replay created a second event").toBe(firstId);
    expect((second.data as { clientUuid?: string } | undefined)?.clientUuid).toBe(eventUuid);

    // ── cleanup: remove the probe cart line (shared e2e DB) ────────────────
    await apiCall(page, "DELETE", `/cart/items/${productId}`);
  });
});
