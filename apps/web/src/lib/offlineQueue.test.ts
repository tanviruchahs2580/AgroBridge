/**
 * Characterization tests for lib/offlineQueue.ts
 * Covers enqueue, flush, dedupe via clientUuid, and documents offline barrier gap.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the api module used by offlineQueue
const mockApi = vi.fn();
const mockIsOnline = vi.fn(() => true);

vi.mock("./api.js", async () => {
  const actual = await vi.importActual<typeof import("./api.js")>("./api.js");
  return {
    ...actual,
    api: (...args: unknown[]) => mockApi(...args),
    isOnline: () => mockIsOnline(),
  };
});

import { enqueue, size, subscribe, flushAll, isQueueable, onEnqueue, onDrop, onSync, dropToastMessage, syncToastMessage } from "./offlineQueue";
import { ApiError } from "./api";

const STORAGE_KEY = "agrobridge.mutationQueue";

function readQueue(): unknown[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

describe("lib/offlineQueue — isQueueable", () => {
  it("allow-lists state-changing methods on /events, /cart and /orders URLs", () => {
    expect(isQueueable("POST", "/api/v1/farms/123/events")).toBe(true);
    expect(isQueueable("PATCH", "/farms/abc/events")).toBe(true);
    expect(isQueueable("DELETE", "/cart/items/9")).toBe(true);
    expect(isQueueable("POST", "/events")).toBe(true);
    expect(isQueueable("POST", "/api/v1/products")).toBe(false);
    expect(isQueueable("POST", "/api/v1/auth/me")).toBe(false);
  });

  // WEB-4: the allow-list used to be URL-only, so a failed read (GET /orders)
  // was queued and later replayed as if it were a mutation — and it inflated the
  // user-facing "pending changes" counter for a request that changes nothing.
  // Only state-changing methods enter the queue now.
  it("never queues read methods — a queued GET is not a pending change", () => {
    expect(isQueueable("GET", "/orders")).toBe(false);
    expect(isQueueable("GET", "/cart")).toBe(false);
    expect(isQueueable("get", "/farms/1/events")).toBe(false);
    expect(isQueueable("HEAD", "/orders/abc")).toBe(false);
    // The same URL as a real mutation is a pending change and stays queueable.
    expect(isQueueable("POST", "/orders/x/status")).toBe(true);
  });

  it("keeps the NEVER_QUEUE exclusion — /orders/checkout is never replayable (any method)", () => {
    expect(isQueueable("POST", "/orders/checkout")).toBe(false);
    expect(isQueueable("PATCH", "/api/v1/orders/checkout/pay")).toBe(false);
  });

  it("method match is case-insensitive; URL match stays case-sensitive and substring-based (characterization)", () => {
    expect(isQueueable("post", "/farms/1/events")).toBe(true);
    expect(isQueueable("POST", "/API/v1/farms/events")).toBe(true); // "/events" still appears verbatim (lowercase) in the path
    expect(isQueueable("POST", "/api/v1/farms/EVENTS")).toBe(false);
    expect(isQueueable("POST", "/api/v1/farms/events?type=other")).toBe(true);
  });
});

describe("lib/offlineQueue — enqueue and dedupe", () => {
  beforeEach(() => {
    localStorage.clear();
    mockApi.mockReset();
    mockIsOnline.mockReturnValue(true);
    // clear attempts map by flushing? We need to reset module's internal attempts Map
    // We do via resetting modules? Instead we ensure flushAll with success clears attempts.
    // For isolation, clear storage and reset mocks.
    vi.restoreAllMocks();
  });
  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
  });

  it("enqueue returns clientUuid and persists entry", () => {
    const id = enqueue({ url: "/farms/123/events", method: "POST", body: { title: "hi" } });
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");
    const q = readQueue();
    expect(q).toHaveLength(1);
    expect((q[0] as any).url).toBe("/farms/123/events");
    expect((q[0] as any).method).toBe("POST");
    expect((q[0] as any).clientUuid).toBe(id);
  });

  it("enqueue uppercases method", () => {
    const id = enqueue({ url: "/farms/1/events", method: "post", body: {} });
    const q = readQueue() as any[];
    expect(q[0].method).toBe("POST");
    expect(q[0].clientUuid).toBe(id);
  });

  it("enqueue ignores non-queueable URLs and returns null (characterization)", () => {
    const id = enqueue({ url: "/api/v1/products", method: "POST", body: {} });
    expect(id).toBeNull();
    expect(readQueue()).toHaveLength(0);
  });

  it("enqueue refuses read methods — a failed GET never becomes a pending change (WEB-4)", () => {
    const id = enqueue({ url: "/orders", method: "GET" });
    expect(id).toBeNull();
    // size() backs the user-facing pending-changes badge: a read that failed
    // offline must not be counted (or replayed) as unsent work.
    expect(size()).toBe(0);
    expect(readQueue()).toHaveLength(0);
  });

  it("dedupe via clientUuid — second enqueue with same clientUuid is no-op", () => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    const first = enqueue({ url: "/farms/1/events", method: "POST", body: { a: 1 }, clientUuid: uuid });
    const _second = enqueue({ url: "/farms/1/events", method: "POST", body: { a: 2 }, clientUuid: uuid });
    expect(first).toBe(uuid);
    // Same explicit clientUuid => deduped (no second entry added)
    expect(size()).toBe(1);
    // body from first call is retained
    const q = readQueue() as any[];
    expect(q[0].body).toEqual({ a: 1 });
  });

  it("different clientUuids create distinct entries", () => {
    const a = enqueue({ url: "/farms/1/events", method: "POST", body: {}, clientUuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    const b = enqueue({ url: "/farms/1/events", method: "POST", body: {}, clientUuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    expect(a).not.toBe(b);
    expect(readQueue()).toHaveLength(2);
  });

  it("auto-generates clientUuid when not provided", () => {
    // Use different bodies so hash dedupe doesn't collapse them (same URL+method would produce identical hashes)
    const id1 = enqueue({ url: "/farms/1/events", method: "POST", body: { n: 1 } });
    const id2 = enqueue({ url: "/farms/1/events", method: "POST", body: { n: 2 } });
    expect(id1).not.toBe(id2);
    expect(size()).toBe(2);
  });

  it("size() reflects persisted queue length", () => {
    expect(size()).toBe(0);
    enqueue({ url: "/farms/1/events", method: "POST" });
    expect(size()).toBe(1);
    enqueue({ url: "/farms/2/events", method: "POST" });
    expect(size()).toBe(2);
  });

  it("subscribe receives immediate count and updates on enqueue", () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);
    expect(cb).toHaveBeenCalledWith(0);
    cb.mockClear();
    enqueue({ url: "/farms/1/events", method: "POST" });
    expect(cb).toHaveBeenCalledWith(1);
    unsub();
    cb.mockClear();
    enqueue({ url: "/farms/2/events", method: "POST" });
    // after unsubscribe, no further calls
    expect(cb).not.toHaveBeenCalled();
    // cleanup
    localStorage.clear();
  });

  it("notifies exactly once per enqueue — no second path to the same toast", () => {
    const cb = vi.fn();
    const unsub = onEnqueue(cb);
    // The window event dispatched alongside the notifier was a duplicate path to
    // the same UI: App.tsx subscribed to both and the offline toast appeared twice.
    const winSpy = vi.fn();
    window.addEventListener("agrobridge:offline-queued", winSpy as EventListener);
    enqueue({ url: "/farms/1/events", method: "POST" });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(winSpy).not.toHaveBeenCalled();
    // non-queueable should not trigger
    cb.mockClear();
    winSpy.mockClear();
    enqueue({ url: "/api/v1/products", method: "POST" });
    expect(cb).not.toHaveBeenCalled();
    expect(winSpy).not.toHaveBeenCalled();
    window.removeEventListener("agrobridge:offline-queued", winSpy as EventListener);
    unsub();
    localStorage.clear();
  });

  it("onEnqueue unsubscribe works", () => {
    const cb = vi.fn();
    const unsub = onEnqueue(cb);
    unsub();
    enqueue({ url: "/farms/1/events", method: "POST" });
    expect(cb).not.toHaveBeenCalled();
    localStorage.clear();
  });

  it("handles corrupt localStorage JSON gracefully (returns empty)", () => {
    localStorage.setItem(STORAGE_KEY, "not-json{{{");
    expect(size()).toBe(0);
    // enqueue should still work and overwrite corrupt entry
    const id = enqueue({ url: "/farms/1/events", method: "POST" });
    expect(id).toBeTruthy();
    expect(size()).toBe(1);
  });

  it("handles localStorage getItem throwing (blocked storage) gracefully", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(size()).toBe(0);
    spy.mockRestore();
  });
});

describe("lib/offlineQueue — flushAll", () => {
  beforeEach(() => {
    localStorage.clear();
    mockApi.mockReset();
    mockIsOnline.mockReturnValue(true);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("flushAll succeeds → entry removed", async () => {
    enqueue({ url: "/farms/1/events", method: "POST", body: { title: "a" } });
    mockApi.mockResolvedValueOnce({ ok: 1 });
    await flushAll();
    expect(mockApi).toHaveBeenCalledTimes(1);
    expect(size()).toBe(0);
  });

  it("flushAll with network/5xx keeps entry for next flush (never throws)", async () => {
    enqueue({ url: "/farms/1/events", method: "POST" });
    // Simulate network error (non-ApiError)
    mockApi.mockRejectedValueOnce(new Error("network down"));
    await flushAll();
    expect(size()).toBe(1);
    // next flush with 5xx ApiError
    mockApi.mockRejectedValueOnce(new ApiError(500, "SERVER_ERROR", "s"));
    await flushAll();
    expect(size()).toBe(1);
    // then success
    mockApi.mockResolvedValueOnce({});
    await flushAll();
    expect(size()).toBe(0);
  });

  it("flushAll re-queues 401/403 once, drops on second strike with warn", async () => {
    const uuid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    enqueue({ url: "/farms/1/events", method: "POST", body: {}, clientUuid: uuid });
    mockApi.mockRejectedValueOnce(new ApiError(401, "UNAUTHORIZED", "no"));
    await flushAll();
    expect(size()).toBe(1); // re-queued
    expect(mockApi).toHaveBeenCalledTimes(1);

    // second flush same auth error → dropped
    mockApi.mockRejectedValueOnce(new ApiError(401, "UNAUTHORIZED", "no"));
    await flushAll();
    expect(size()).toBe(0);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("dropping mutation"), expect.any(String));
  });

  it("flushAll drops other 4xx immediately with warn (will never succeed)", async () => {
    enqueue({ url: "/farms/1/events", method: "POST" });
    mockApi.mockRejectedValueOnce(new ApiError(400, "VALIDATION_ERROR", "bad"));
    await flushAll();
    expect(size()).toBe(0);
    expect(console.warn).toHaveBeenCalled();
  });

  it("flushAll respects offline barrier — early returns without calling api when offline", async () => {
    enqueue({ url: "/farms/1/events", method: "POST" });
    mockIsOnline.mockReturnValue(false);
    await flushAll();
    expect(mockApi).not.toHaveBeenCalled();
    expect(size()).toBe(1);
    // restore online and flush should proceed
    mockIsOnline.mockReturnValue(true);
    mockApi.mockResolvedValueOnce({});
    await flushAll();
    expect(size()).toBe(0);
  });

  it("flushAll processes queue in order and handles mixed outcomes", async () => {
    const u1 = enqueue({ url: "/farms/1/events", method: "POST", body: { n: 1 }, clientUuid: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" })!;
    const u2 = enqueue({ url: "/farms/1/events", method: "POST", body: { n: 2 }, clientUuid: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" })!;
    const u3 = enqueue({ url: "/farms/1/events", method: "POST", body: { n: 3 }, clientUuid: "ffffffff-ffff-4fff-8fff-ffffffffffff" })!;
    // u1 success, u2 auth -> requeue, u3 validation -> drop
    mockApi
      .mockResolvedValueOnce({}) // u1
      .mockRejectedValueOnce(new ApiError(403, "FORBIDDEN", "f")) // u2 first strike
      .mockRejectedValueOnce(new ApiError(422, "VALIDATION_ERROR", "bad")); // u3
    await flushAll();
    // remaining should be u2 only (requeued)
    expect(size()).toBe(1);
    const remaining = readQueue() as any[];
    expect(remaining[0].clientUuid).toBe(u2);
    // second flush u2 auth second strike -> dropped
    mockApi.mockRejectedValueOnce(new ApiError(403, "FORBIDDEN", "f"));
    await flushAll();
    expect(size()).toBe(0);
    expect(console.warn).toHaveBeenCalled();
    void u1; void u3; // suppress unused
  });

  it("flushAll when queue empty does nothing and does not call api", async () => {
    expect(size()).toBe(0);
    await flushAll();
    expect(mockApi).not.toHaveBeenCalled();
  });

  // AUD-112b: a permanently refused write used to disappear with only a
  // console.warn; onDrop is the hook App.tsx uses to raise the bilingual toast.
  it("notifies onDrop with the discarded entry and status on a permanent 4xx", async () => {
    const dropped: { url: string; method: string }[] = [];
    const statuses: number[] = [];
    const unsub = onDrop((entry, status) => {
      dropped.push({ url: entry.url, method: entry.method });
      statuses.push(status);
    });
    enqueue({ url: "/cart/items/9", method: "DELETE" });
    mockApi.mockRejectedValueOnce(new ApiError(400, "VALIDATION_ERROR", "bad"));
    await flushAll();
    expect(size()).toBe(0);
    expect(dropped).toEqual([{ url: "/cart/items/9", method: "DELETE" }]);
    expect(statuses).toEqual([400]);
    unsub();
  });

  it("onDrop stays silent while a 401/403 is re-queued, then fires on the second strike", async () => {
    const cb = vi.fn();
    const unsub = onDrop(cb);
    enqueue({ url: "/farms/1/events", method: "POST" });
    mockApi.mockRejectedValueOnce(new ApiError(401, "UNAUTHORIZED", "no"));
    await flushAll();
    expect(size()).toBe(1); // re-queued once — nothing is lost yet, no toast
    expect(cb).not.toHaveBeenCalled();

    mockApi.mockRejectedValueOnce(new ApiError(403, "FORBIDDEN", "no"));
    await flushAll();
    expect(size()).toBe(0);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][1]).toBe(403);
    unsub();
  });

  it("onDrop unsubscribe stops delivery", async () => {
    const cb = vi.fn();
    onDrop(cb)();
    enqueue({ url: "/orders/x/status", method: "POST" });
    mockApi.mockRejectedValueOnce(new ApiError(422, "UNPROCESSABLE", "no"));
    await flushAll();
    expect(size()).toBe(0);
    expect(cb).not.toHaveBeenCalled();
  });

  it("flushAll never throws even when api throws non-ApiError", async () => {
    enqueue({ url: "/farms/1/events", method: "POST" });
    mockApi.mockRejectedValueOnce(new TypeError("unexpected"));
    await expect(flushAll()).resolves.toBeUndefined();
    expect(size()).toBe(1); // kept for retry
  });
});

// G-07: a flush that saved queued work must say so (once, with a count), and a
// drop must distinguish a state conflict (409/422 → "needs your review") from a
// plain permanent failure ("discarded").
describe("lib/offlineQueue — synced/drop outcome signalling (G-07)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockApi.mockReset();
    mockIsOnline.mockReturnValue(true);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("onSync fires once with the count of entries that landed", async () => {
    const cb = vi.fn();
    const unsub = onSync(cb);
    enqueue({ url: "/farms/1/events", method: "POST", body: { n: 1 }, clientUuid: "11111111-1111-4111-8111-111111111111" });
    enqueue({ url: "/cart/items/9", method: "DELETE", body: { n: 2 }, clientUuid: "22222222-2222-4222-8222-222222222222" });
    mockApi.mockResolvedValueOnce({}).mockResolvedValueOnce({});
    await flushAll();
    expect(size()).toBe(0);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(2);
    unsub();
  });

  it("onSync stays silent when nothing synced (all entries kept for retry)", async () => {
    const cb = vi.fn();
    const unsub = onSync(cb);
    enqueue({ url: "/farms/1/events", method: "POST" });
    mockApi.mockRejectedValueOnce(new ApiError(500, "SERVER_ERROR", "boom"));
    await flushAll();
    expect(size()).toBe(1);
    expect(cb).not.toHaveBeenCalled();
    unsub();
  });

  it("onSync unsubscribe stops delivery", async () => {
    const cb = vi.fn();
    onSync(cb)();
    enqueue({ url: "/farms/1/events", method: "POST" });
    mockApi.mockResolvedValueOnce({});
    await flushAll();
    expect(cb).not.toHaveBeenCalled();
  });

  it("onDrop reports 409/422 as a conflict and other 4xx as discarded", async () => {
    const outcomes: string[] = [];
    const unsub = onDrop((_entry, _status, outcome) => outcomes.push(outcome));
    enqueue({ url: "/orders/x/status", method: "POST", body: { a: 1 }, clientUuid: "33333333-3333-4333-8333-333333333333" });
    enqueue({ url: "/cart/items/9", method: "DELETE", body: { b: 2 }, clientUuid: "44444444-4444-4444-8444-444444444444" });
    enqueue({ url: "/farms/1/events", method: "POST", body: { c: 3 }, clientUuid: "55555555-5555-4555-8555-555555555555" });
    mockApi
      .mockRejectedValueOnce(new ApiError(409, "CONFLICT", "already exists"))
      .mockRejectedValueOnce(new ApiError(400, "VALIDATION_ERROR", "bad"))
      .mockRejectedValueOnce(new ApiError(422, "UNPROCESSABLE", "stale"));
    await flushAll();
    expect(size()).toBe(0);
    expect(outcomes).toEqual(["conflict", "discarded", "conflict"]);
    unsub();
  });

  it("dropToastMessage maps conflict vs discarded to different copy (both languages)", async () => {
    const entry = { url: "/cart/items/9", method: "DELETE", clientUuid: "x", payloadHash: "y" };
    for (const lang of ["bn", "en"] as const) {
      const conflict = dropToastMessage(entry, "conflict", lang);
      const discarded = dropToastMessage(entry, "discarded", lang);
      expect(conflict).not.toBe(discarded);
      expect(conflict.length).toBeGreaterThan(0);
      expect(discarded.length).toBeGreaterThan(0);
    }
  });

  it("syncToastMessage uses singular/plural English and reads the count", async () => {
    const entry = { url: "/farms/1/events", method: "POST", clientUuid: "x", payloadHash: "y" };
    expect(syncToastMessage(1, "en")).toContain("1");
    expect(syncToastMessage(3, "en")).toContain("3");
    expect(syncToastMessage(1, "en")).not.toBe(syncToastMessage(3, "en"));
    expect(syncToastMessage(2, "bn")).toContain("2");
    void entry;
  });
});

describe("lib/offlineQueue — OFFLINE BARRIER GAP (characterization — documents current limitation)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockApi.mockReset();
    mockIsOnline.mockReturnValue(true);
  });
  afterEach(() => localStorage.clear());

  it("GAP: enqueue does NOT gate on isOnline — it always queues allow-listed entries regardless of online status (offline barrier is flush-time only)", () => {
    mockIsOnline.mockReturnValue(true);
    const idOnline = enqueue({ url: "/farms/1/events", method: "POST", body: { online: true } });
    expect(idOnline).toBeTruthy();
    expect(size()).toBe(1);
    localStorage.clear();

    mockIsOnline.mockReturnValue(false);
    const idOffline = enqueue({ url: "/farms/1/events", method: "POST", body: { offline: true } });
    expect(idOffline).toBeTruthy();
    expect(size()).toBe(1);
    // Documented: there is no `if (!isOnline()) return null` inside enqueue itself.
    // This means callers can manually queue even while online, and
    // `lib/api.ts` is the only place that decides WHEN to call enqueue.
  });

  it("GAP: flushAll early-return when offline means queued mutations stay durable until next online event — no automatic retry timer", async () => {
    enqueue({ url: "/farms/1/events", method: "POST" });
    mockIsOnline.mockReturnValue(false);
    await flushAll();
    expect(mockApi).not.toHaveBeenCalled();
    expect(size()).toBe(1);
    // No background timer retries; only App.tsx's `onOnlineStatusChange` or boot flush triggers retry.
    // If the 'online' event is missed (e.g., Playwright mobile emulation without event dispatch),
    // the queue relies on App's heartbeat poll (2s) — document that offline barrier is not instant.
  });

  it("GAP: api.ts trySyncEnqueue is best-effort async import — if offlineQueue not yet loaded, sync enqueue may be missed and only async path enqueues (race)", async () => {
    // This test documents the lazy import gap in `lib/api.ts#getOfflineQueue`:
    // `trySyncEnqueue` checks `_offlineQueue?.isQueueable` only if already loaded.
    // A network failure that happens before the dynamic import resolves will not enqueue
    // synchronously; it falls back to `await getOfflineQueue()` in the NetworkError handler.
    // For queueable URLs this still eventually enqueues, but for non-queueable it silently drops.
    // No assertion — documentation only; the `api.test.ts` offline-enqueue test already characterizes this.
    expect(isQueueable("POST", "/farms/1/events")).toBe(true);
    expect(isQueueable("POST", "/products")).toBe(false);
  });

  it("GAP: dedupe uses clientUuid AND payload hash — identical payloads with different auto-generated UUIDs are collapsed by hash dedupe", () => {
    const a = enqueue({ url: "/farms/1/events", method: "POST", body: { title: "same", type: "FERTILIZER" } });
    const b = enqueue({ url: "/farms/1/events", method: "POST", body: { title: "same", type: "FERTILIZER" } });
    // Hash dedupe: same method+url+body => same hash => second is rejected
    expect(size()).toBe(1);
    expect(a).toBeTruthy();
    expect(b).toBeNull(); // second identical payload is deduped
  });
});
