/**
 * Tests for the data layer (lib/useResource).
 *
 * These are the first component-level tests in the repository: the hook owns
 * loading/error/refetch/supersession behaviour that ten screens depend on, and the
 * behaviours asserted here are exactly the ones that used to be hand-rolled and
 * wrong (silent stale responses, a refresh blanking the page, a failing block taking
 * the whole screen with it).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

const mockApi = vi.fn();
vi.mock("./api.js", async () => {
  const actual = await vi.importActual<typeof import("./api.js")>("./api.js");
  return { ...actual, api: (...args: unknown[]) => mockApi(...args), hasToken: () => true };
});

// The hook reads the language from the session context; the provider is heavy, so
// the context module is stubbed with a fixed Bangla session.
vi.mock("./session", () => ({
  useSession: () => ({ session: { userId: "u1", fullName: "Test", role: "FARMER", lang: "bn", dark: false, district: null }, loading: false }),
}));

import { useResource, invalidate, type Resource } from "./useResource";
import { ApiError } from "./api";

function mount<T>(use: () => Resource<T>, opts: { strict?: boolean } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  let latest: Resource<T> | null = null;
  function Probe() {
    latest = use();
    return null;
  }
  const tree = opts.strict
    ? React.createElement(React.StrictMode, null, React.createElement(Probe))
    : React.createElement(Probe);
  act(() => root.render(tree));
  return {
    get: () => latest!,
    unmount: () => act(() => root.unmount()),
  };
}

/** Lets pending promises settle inside act(). */
async function settle(times = 3) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  mockApi.mockReset();
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("useResource — loading, data, error", () => {
  it("starts loading, then exposes the data with no error", async () => {
    mockApi.mockResolvedValueOnce({ balancePaisa: 1234 });
    const r = mount(() => useResource("wallet", () => mockApi()));

    expect(r.get().loading).toBe(true);
    expect(r.get().data).toBeNull();

    await settle();
    expect(r.get().loading).toBe(false);
    expect(r.get().data).toEqual({ balancePaisa: 1234 });
    expect(r.get().error).toBeNull();
    r.unmount();
  });

  it("maps a known failure code to localized text", async () => {
    // PHONE_NOT_VERIFIED has a dictionary entry, so the hook must surface that
    // sentence rather than the raw API message. (For codes with no entry mapError
    // deliberately passes the API's own user-facing text through — covered below.)
    mockApi.mockRejectedValueOnce(new ApiError(403, "PHONE_NOT_VERIFIED", "Phone number must be verified before this action"));
    const r = mount(() => useResource("wallet", () => mockApi()));
    await settle();

    expect(r.get().loading).toBe(false);
    expect(r.get().error).toBeTruthy();
    expect(r.get().error).not.toBe("Phone number must be verified before this action");
    expect(r.get().data).toBeNull();
    r.unmount();
  });

  it("passes an unmapped server message through unchanged", async () => {
    mockApi.mockRejectedValueOnce(new ApiError(422, "SOME_NEW_CODE", "Resolve your pending orders first"));
    const r = mount(() => useResource("wallet", () => mockApi()));
    await settle();
    expect(r.get().error).toBe("Resolve your pending orders first");
    r.unmount();
  });

  it("reload() refetches and clears a previous error", async () => {
    mockApi.mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "boom"));
    const r = mount(() => useResource("wallet", () => mockApi()));
    await settle();
    expect(r.get().error).toBeTruthy();

    mockApi.mockResolvedValueOnce({ balancePaisa: 10 });
    await act(async () => {
      await r.get().reload();
    });
    expect(r.get().error).toBeNull();
    expect(r.get().data).toEqual({ balancePaisa: 10 });
    r.unmount();
  });

  it("keeps existing data on screen while a reload is in flight (refreshing, not loading)", async () => {
    mockApi.mockResolvedValueOnce({ n: 1 });
    const r = mount(() => useResource("wallet", () => mockApi()));
    await settle();
    expect(r.get().data).toEqual({ n: 1 });

    let release!: (v: unknown) => void;
    mockApi.mockImplementationOnce(() => new Promise((res) => { release = res; }));
    act(() => {
      void r.get().reload();
    });
    await settle(1);

    // The page must not blank: data stays, and the state is reported as refreshing.
    expect(r.get().data).toEqual({ n: 1 });
    expect(r.get().loading).toBe(false);
    expect(r.get().refreshing).toBe(true);

    await act(async () => {
      release({ n: 2 });
    });
    expect(r.get().data).toEqual({ n: 2 });
    expect(r.get().refreshing).toBe(false);
    r.unmount();
  });
});

describe("useResource — StrictMode (development renders)", () => {
  it("still settles when React double-invokes effects", async () => {
    // StrictMode mounts, cleans up and mounts again on the same instance. An
    // "unmounted" flag that is only ever set false silently discards every result,
    // so the app's dev server rendered skeletons forever while tests and production
    // builds passed — this test is the reason that cannot come back.
    mockApi.mockResolvedValue({ balancePaisa: 42 });
    const r = mount(() => useResource("wallet", () => mockApi()), { strict: true });
    await settle(4);

    expect(r.get().loading).toBe(false);
    expect(r.get().data).toEqual({ balancePaisa: 42 });
    expect(r.get().error).toBeNull();
    r.unmount();
  });

  it("still refetches on invalidation under StrictMode", async () => {
    mockApi.mockImplementation((kind: string) => Promise.resolve({ kind }));
    const r = mount(() => useResource("wallet", () => mockApi("wallet")), { strict: true });
    await settle(4);
    const before = mockApi.mock.calls.length;

    await act(async () => {
      invalidate("wallet");
    });
    await settle(4);

    expect(mockApi.mock.calls.length).toBeGreaterThan(before);
    expect(r.get().data).toEqual({ kind: "wallet" });
    r.unmount();
  });
});

describe("useResource — invalidation and supersession", () => {
  it("invalidate(key) refetches subscribers of that key only", async () => {
    // Fetchers tag their calls so the assertion is per resource family — the
    // invariant is "the invalidated key refetches and the other one does not",
    // not a global call count (which depends on how React flushes effects).
    mockApi.mockImplementation((kind: string) => Promise.resolve({ kind }));
    const wallet = mount(() => useResource("wallet", () => mockApi("wallet")));
    const orders = mount(() => useResource("orders", () => mockApi("orders")));
    await settle();

    const countOf = (kind: string) => mockApi.mock.calls.filter((c) => c[0] === kind).length;
    const walletBefore = countOf("wallet");
    const ordersBefore = countOf("orders");
    expect(walletBefore).toBeGreaterThan(0);
    expect(ordersBefore).toBeGreaterThan(0);

    await act(async () => {
      invalidate("wallet");
    });
    await settle();

    expect(countOf("wallet")).toBe(walletBefore + 1);
    expect(countOf("orders")).toBe(ordersBefore);
    wallet.unmount();
    orders.unmount();
  });

  it("unsubscribes on unmount: invalidating afterwards does not fetch", async () => {
    mockApi.mockImplementation((kind: string) => Promise.resolve({ kind }));
    const r = mount(() => useResource("wallet", () => mockApi("wallet")));
    await settle();
    const before = mockApi.mock.calls.length;
    r.unmount();

    await act(async () => {
      invalidate("wallet");
    });
    await settle();
    expect(mockApi.mock.calls.length).toBe(before);
  });

  it("ignores a stale response that resolves after a newer one (supersession)", async () => {
    let releaseSlow!: (v: unknown) => void;
    mockApi.mockImplementationOnce(() => new Promise((res) => { releaseSlow = res; }));
    const r = mount(() => useResource("wallet", () => mockApi()));

    // Second request starts and resolves first.
    mockApi.mockResolvedValueOnce({ version: "new" });
    await act(async () => {
      await r.get().reload();
    });
    expect(r.get().data).toEqual({ version: "new" });

    // The older request now resolves with stale data; it must be discarded.
    await act(async () => {
      releaseSlow({ version: "stale" });
    });
    expect(r.get().data).toEqual({ version: "new" });
    r.unmount();
  });

  it("setData updates locally without a request (optimistic UI)", async () => {
    mockApi.mockResolvedValueOnce({ count: 1 });
    const r = mount(() => useResource("wallet", () => mockApi()));
    await settle();
    const before = mockApi.mock.calls.length;

    act(() => r.get().setData({ count: 2 }));
    expect(r.get().data).toEqual({ count: 2 });
    expect(mockApi.mock.calls.length).toBe(before);
    r.unmount();
  });
});
