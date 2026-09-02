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

import { enqueue, size, subscribe, flushAll, isQueueable, onEnqueue } from "./offlineQueue.js";
import { ApiError } from "./api.js";

const STORAGE_KEY = "agrobridge.mutationQueue";

function readQueue(): unknown[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

describe("lib/offlineQueue — isQueueable", () => {
  it("allow-lists only URLs containing /events", () => {
    expect(isQueueable("/api/v1/farms/123/events")).toBe(true);
    expect(isQueueable("/farms/abc/events")).toBe(true);
    expect(isQueueable("/api/v1/products")).toBe(false);
    expect(isQueueable("/api/v1/auth/me")).toBe(false);
    expect(isQueueable("/events")).toBe(true);
  });

  it("is case-sensitive and substring-based (characterization)", () => {
    expect(isQueueable("/API/v1/farms/events")).toBe(true); // includes lower /events? no — case sensitive, so false? actually url.includes("/events") is case-sensitive
    expect(isQueueable("/api/v1/farms/EVENTS")).toBe(false);
    expect(isQueueable("/api/v1/farms/events?type=other")).toBe(true);
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

  it("dedupe via clientUuid — second enqueue with same clientUuid is no-op", () => {
    const uuid = "11111111-1111-4111-8111-111111111111";
    const first = enqueue({ url: "/farms/1/events", method: "POST", body: { a: 1 }, clientUuid: uuid });
    const second = enqueue({ url: "/farms/1/events", method: "POST", body: { a: 2 }, clientUuid: uuid });
    expect(first).toBe(uuid);
    expect(second).toBe(uuid);
    const q = readQueue() as any[];
    expect(q).toHaveLength(1);
    // body from first call is retained
    expect(q[0].body).toEqual({ a: 1 });
  });

  it("different clientUuids create distinct entries", () => {
    const a = enqueue({ url: "/farms/1/events", method: "POST", body: {}, clientUuid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
    const b = enqueue({ url: "/farms/1/events", method: "POST", body: {}, clientUuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    expect(a).not.toBe(b);
    expect(readQueue()).toHaveLength(2);
  });

  it("auto-generates clientUuid when not provided", () => {
    const id1 = enqueue({ url: "/farms/1/events", method: "POST" });
    const id2 = enqueue({ url: "/farms/1/events", method: "POST" });
    expect(id1).not.toBe(id2);
    expect(readQueue()).toHaveLength(2);
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

  it("onEnqueue notifier fires on successful enqueue and dispatches window event", () => {
    const cb = vi.fn();
    const unsub = onEnqueue(cb);
    const winSpy = vi.fn();
    window.addEventListener("agrobridge:offline-queued", winSpy as EventListener);
    enqueue({ url: "/farms/1/events", method: "POST" });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(winSpy).toHaveBeenCalledTimes(1);
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

  it("flushAll never throws even when api throws non-ApiError", async () => {
    enqueue({ url: "/farms/1/events", method: "POST" });
    mockApi.mockRejectedValueOnce(new TypeError("unexpected"));
    await expect(flushAll()).resolves.toBeUndefined();
    expect(size()).toBe(1); // kept for retry
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
    expect(isQueueable("/farms/1/events")).toBe(true);
    expect(isQueueable("/products")).toBe(false);
  });

  it("GAP: dedupe is clientUuid-only — identical payloads with different UUIDs are treated as distinct mutations (no payload dedupe)", () => {
    const a = enqueue({ url: "/farms/1/events", method: "POST", body: { title: "same", type: "FERTILIZER" } });
    const b = enqueue({ url: "/farms/1/events", method: "POST", body: { title: "same", type: "FERTILIZER" } });
    expect(a).not.toBe(b);
    expect(size()).toBe(2);
  });
});
