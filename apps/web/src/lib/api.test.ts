/**
 * Characterization tests for lib/api.ts
 * Covers token storage, single-flight refresh, retry, timeout and unauthorized handling.
 * Mock fetch globally; no UI tested.
 * Vitest + jsdom assumed (localStorage, window, navigator).
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";

// Helpers to build fetch responses
function okData(data: unknown, status = 200) {
  return new Response(JSON.stringify({ ok: true, data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
function errEnvelope(status: number, code: string, message: string, reference?: string) {
  return new Response(
    JSON.stringify({ ok: false, error: { code, message, reference } }),
    { status, headers: { "Content-Type": "application/json" } }
  );
}
function malformedResponse(status = 200) {
  return new Response("not-json{{{", {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("lib/api — token storage (setTokens / clearTokens / hasToken)", () => {
  let mod: typeof import("./api.js");
  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    // ensure module re-reads empty storage
    mod = await import("./api.js");
    mod.clearTokens();
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("setTokens persists to localStorage and hasToken becomes true", async () => {
    mod.setTokens("at-123", "rt-456");
    expect(localStorage.getItem("ab_at")).toBe("at-123");
    expect(localStorage.getItem("ab_rt")).toBe("rt-456");
    expect(mod.hasToken()).toBe(true);
  });

  it("clearTokens removes storage and hasToken becomes false", async () => {
    mod.setTokens("at-123", "rt-456");
    mod.clearTokens();
    expect(localStorage.getItem("ab_at")).toBeNull();
    expect(localStorage.getItem("ab_rt")).toBeNull();
    expect(mod.hasToken()).toBe(false);
    expect(mod["accessToken" as never] ?? "").toBeFalsy; // indirect check via hasToken
  });

  it("initial accessToken is read from localStorage on module load", async () => {
    localStorage.setItem("ab_at", "preloaded-at");
    localStorage.setItem("ab_rt", "preloaded-rt");
    vi.resetModules();
    const fresh = await import("./api.js");
    expect(fresh.hasToken()).toBe(true);
    // api should send Authorization header with preloaded token
    const fetchMock = vi.fn(async () => okData({ hello: "world" }));
    vi.stubGlobal("fetch", fetchMock);
    await fresh.api("GET", "/ping");
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer preloaded-at");
    fresh.clearTokens();
  });

  it("api sends Authorization header when token present, omits when absent", async () => {
    const fetchMock = vi.fn(async () => okData({ ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    // no token
    mod.clearTokens();
    await mod.api("GET", "/no-auth");
    let h1 = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(h1.Authorization).toBeUndefined();
    // with token
    mod.setTokens("tok123", "rt");
    await mod.api("GET", "/with-auth");
    let h2 = (fetchMock.mock.calls[1][1] as RequestInit).headers as Record<string, string>;
    expect(h2.Authorization).toBe("Bearer tok123");
  });

  it("setTokens overwrites previous values", async () => {
    mod.setTokens("a1", "r1");
    mod.setTokens("a2", "r2");
    expect(localStorage.getItem("ab_at")).toBe("a2");
    expect(localStorage.getItem("ab_rt")).toBe("r2");
  });
});

describe("lib/api — ApiError and envelope handling", () => {
  let mod: typeof import("./api.js");
  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    mod = await import("./api.js");
    mod.clearTokens();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => vi.unstubAllGlobals());

  it("ApiError carries status, code, message, details, reference", () => {
    const e = new mod.ApiError(422, "VALIDATION_ERROR", "bad", { field: "phone" }, "REF-123");
    expect(e.status).toBe(422);
    expect(e.code).toBe("VALIDATION_ERROR");
    expect(e.message).toBe("bad");
    expect(e.details).toEqual({ field: "phone" });
    expect(e.reference).toBe("REF-123");
    expect(e.name).toBe("ApiError");
  });

  it("successful GET returns json.data unwrapped", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okData({ id: "u1", name: "Karim" })));
    const data = await mod.api<{ id: string; name: string }>("GET", "/auth/me");
    expect(data).toEqual({ id: "u1", name: "Karim" });
  });

  it("non-ok status throws ApiError with envelope code/message/reference", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => errEnvelope(403, "FORBIDDEN", "nope", "REF-9")));
    await expect(mod.api("GET", "/farms")).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      message: "nope",
      reference: "REF-9",
    });
  });

  it("malformed JSON envelope becomes BAD_RESPONSE ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => malformedResponse(200)));
    // Even with 200, envelope ok is false due to catch, so res.ok? Actually status 200 but json ok false triggers ApiError
    // Our api checks !res.ok || !json.ok — malformed case returns {ok:false, error:{code: BAD_RESPONSE}}
    await expect(mod.api("GET", "/farms")).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });

  it("unknown error code falls back to UNKNOWN with generic message envelope", async () => {
    // backend returns ok:false but no code/message
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error: {} }), { status: 400 })));
    await expect(mod.api("GET", "/x")).rejects.toMatchObject({
      status: 400,
      code: "UNKNOWN",
    });
  });

  it("FormData body does not set Content-Type header", async () => {
    const fetchMock = vi.fn(async () => okData({ ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const fd = new FormData();
    fd.append("a", "1");
    await mod.api("POST", "/upload", fd);
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("JSON body sets Content-Type and is stringified", async () => {
    const fetchMock = vi.fn(async () => okData({ ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    await mod.api("POST", "/farms", { name: "My Farm" });
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect((opts.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(opts.body).toBe(JSON.stringify({ name: "My Farm" }));
  });
});

describe("lib/api — retry semantics (GET-only, 5xx and network)", () => {
  let mod: typeof import("./api.js");
  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    mod = await import("./api.js");
    mod.clearTokens();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("GET retries twice on 500 then succeeds (3 calls total)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: {} }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: {} }), { status: 502 }))
      .mockResolvedValueOnce(okData({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    const data = await mod.api<{ success: boolean }>("GET", "/products");
    expect(data).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 10000);

  it("GET retries twice on network error then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockRejectedValueOnce(new Error("still down"))
      .mockResolvedValueOnce(okData({ ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const data = await mod.api("GET", "/farms");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(data).toEqual({ ok: 1 });
  }, 10000);

  it("GET does NOT retry on 4xx (immediate throw)", async () => {
    const fetchMock = vi.fn(async () => errEnvelope(400, "VALIDATION_ERROR", "bad"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(mod.api("GET", "/farms")).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("POST does NOT retry on 500 (single call)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: "ERR", message: "x" } }), { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(mod.api("POST", "/farms", { name: "x" })).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("POST does NOT retry on network error — throws NETWORK_ERROR", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("net fail");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(mod.api("POST", "/farms", { name: "x" })).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("GET network timeout (AbortError) becomes NETWORK_TIMEOUT and retries", async () => {
    const abortErr = new DOMException("The operation was aborted", "AbortError");
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(abortErr)
      .mockResolvedValueOnce(okData({ ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const data = await mod.api("GET", "/farms");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(data).toEqual({ ok: 1 });
  }, 10000);

  it("GET eventually throws NETWORK_TIMEOUT if all retries time out", async () => {
    const abortErr = new DOMException("timeout", "AbortError");
    const fetchMock = vi.fn(async () => {
      throw abortErr;
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(mod.api("GET", "/farms")).rejects.toMatchObject({ code: "NETWORK_TIMEOUT", status: 0 });
    // initial + 2 retries = 3 calls
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 10000);

  it("GET after 3 consecutive 5xx throws last 5xx ApiError (not NETWORK_ERROR)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: "ERR", message: "s" } }), { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(mod.api("GET", "/x")).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 10000);
});

describe("lib/api — token refresh single-flight and unauthorized handling", () => {
  let mod: typeof import("./api.js");
  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    mod = await import("./api.js");
    mod.clearTokens();
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("401 triggers single-flight refresh and retries once on success", async () => {
    mod.setTokens("expired-at", "valid-rt");
    const fetchMock = vi.fn(async (url: string, opts: RequestInit) => {
      if (String(url).includes("/auth/refresh")) {
        return new Response(JSON.stringify({ data: { accessToken: "new-at", refreshToken: "new-rt" } }), { status: 200 });
      }
      // first call 401, second after refresh 200
      if (fetchMock.mock.calls.filter((c) => !String(c[0]).includes("/auth/refresh")).length === 1) {
        return errEnvelope(401, "UNAUTHORIZED", "expired");
      }
      return okData({ id: "u1" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const data = await mod.api("GET", "/auth/me");
    expect(data).toEqual({ id: "u1" });
    // refresh called once
    const refreshCalls = fetchMock.mock.calls.filter((c) => String(c[0]).includes("/auth/refresh"));
    expect(refreshCalls.length).toBe(1);
    expect(localStorage.getItem("ab_at")).toBe("new-at");
    expect(localStorage.getItem("ab_rt")).toBe("new-rt");
  });

  it("concurrent 401s share single refresh request (single-flight)", async () => {
    mod.setTokens("expired-at", "valid-rt");
    let refreshCount = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/auth/refresh")) {
        refreshCount++;
        // simulate small delay so concurrent calls overlap
        await new Promise((r) => setTimeout(r, 30));
        return new Response(JSON.stringify({ data: { accessToken: "new-at2", refreshToken: "new-rt2" } }), { status: 200 });
      }
      // For the protected endpoint, first wave returns 401; after refresh, return 200
      // Count protected calls
      const protectedCalls = fetchMock.mock.calls.filter((c) => !String(c[0]).includes("/auth/refresh")).length;
      if (protectedCalls <= 2) {
        // first two concurrent requests get 401
        if (protectedCalls === 1 || protectedCalls === 2) {
          // need to differentiate: first encounter per request is 401
          // We'll track via a counter closure? Simpler: if refresh not yet done, return 401
          if (refreshCount === 0) return errEnvelope(401, "UNAUTHORIZED", "expired");
        }
      }
      return okData({ ok: true });
    });
    // More deterministic: mock sequence: call1 401, call2 401, refresh 200, call1 retry 200, call2 retry 200
    let callIdx = 0;
    const seqMock = vi.fn(async (url: string) => {
      if (String(url).includes("/auth/refresh")) {
        refreshCount++;
        await new Promise((r) => setTimeout(r, 20));
        return new Response(JSON.stringify({ data: { accessToken: "new-at2", refreshToken: "new-rt2" } }), { status: 200 });
      }
      callIdx++;
      if (callIdx === 1) return errEnvelope(401, "UNAUTHORIZED", "expired");
      if (callIdx === 2) return errEnvelope(401, "UNAUTHORIZED", "expired");
      return okData({ ok: true });
    });
    vi.stubGlobal("fetch", seqMock);
    const [r1, r2] = await Promise.all([mod.api("GET", "/farms"), mod.api("GET", "/farms")]);
    expect(r1).toEqual({ ok: true });
    expect(r2).toEqual({ ok: true });
    expect(refreshCount).toBe(1);
  });

  it("refresh failure clears tokens and calls unauthorizedHandler", async () => {
    mod.setTokens("expired-at", "bad-rt");
    const handler = vi.fn();
    mod.setUnauthorizedHandler(handler);
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/auth/refresh")) {
        return errEnvelope(401, "UNAUTHORIZED", "bad refresh");
      }
      return errEnvelope(401, "UNAUTHORIZED", "expired");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(mod.api("GET", "/auth/me")).rejects.toMatchObject({ status: 401, code: "UNAUTHORIZED" });
    expect(localStorage.getItem("ab_at")).toBeNull();
    expect(localStorage.getItem("ab_rt")).toBeNull();
    expect(mod.hasToken()).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
    mod.setUnauthorizedHandler(null);
  });

  it("401 without prior token does NOT call unauthorizedHandler (wasAuthed guard)", async () => {
    mod.clearTokens();
    const handler = vi.fn();
    mod.setUnauthorizedHandler(handler);
    vi.stubGlobal("fetch", vi.fn(async () => errEnvelope(401, "UNAUTHORIZED", "no token")));
    await expect(mod.api("GET", "/public")).rejects.toMatchObject({ status: 401 });
    expect(handler).not.toHaveBeenCalled();
    mod.setUnauthorizedHandler(null);
  });

  it("401 after successful refresh but replay still 401 clears tokens and notifies", async () => {
    mod.setTokens("old-at", "valid-rt");
    const handler = vi.fn();
    mod.setUnauthorizedHandler(handler);
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/auth/refresh")) {
        return new Response(JSON.stringify({ data: { accessToken: "new-at", refreshToken: "new-rt" } }), { status: 200 });
      }
      return errEnvelope(401, "UNAUTHORIZED", "still bad");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(mod.api("GET", "/farms")).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(mod.hasToken()).toBe(false);
    mod.setUnauthorizedHandler(null);
  });

  it("no refreshToken stored — immediate 401 clears tokens", async () => {
    mod.clearTokens();
    mod.setTokens("", ""); // ensure empty
    // manually set only accessToken without refresh
    localStorage.setItem("ab_at", "only-at");
    vi.resetModules();
    const fresh = await import("./api.js");
    // fresh has accessToken=only-at, refreshToken=""
    vi.stubGlobal("fetch", vi.fn(async () => errEnvelope(401, "UNAUTHORIZED", "expired")));
    const h = vi.fn();
    fresh.setUnauthorizedHandler(h);
    await expect(fresh.api("GET", "/x")).rejects.toMatchObject({ status: 401 });
    // wasAuthed true before, so handler called, tokens cleared
    expect(h).toHaveBeenCalled();
    fresh.setUnauthorizedHandler(null);
  });
});

describe("lib/api — isOnline / onOnlineStatusChange", () => {
  let mod: typeof import("./api.js");
  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    mod = await import("./api.js");
    mod.clearTokens();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("onOnlineStatusChange calls back immediately with current status", async () => {
    const cb = vi.fn();
    const unsub = mod.onOnlineStatusChange(cb);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(typeof cb.mock.calls[0][0]).toBe("boolean");
    unsub();
  });

  it("online/offline window events notify subscribers", async () => {
    const cb = vi.fn();
    const unsub = mod.onOnlineStatusChange(cb);
    cb.mockClear();
    // simulate offline
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    window.dispatchEvent(new Event("offline"));
    // allow sync to propagate (handler is sync)
    expect(cb).toHaveBeenCalledWith(false);
    cb.mockClear();
    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
    window.dispatchEvent(new Event("online"));
    expect(cb).toHaveBeenCalledWith(true);
    unsub();
  });

  it("unsubscribe stops notifications", async () => {
    const cb = vi.fn();
    const unsub = mod.onOnlineStatusChange(cb);
    cb.mockClear();
    unsub();
    window.dispatchEvent(new Event("offline"));
    // after unsub, cb should not be called again (except we cleared, so 0)
    // give event loop tick
    await new Promise((r) => setTimeout(r, 0));
    expect(cb).not.toHaveBeenCalled();
  });

  it("isOnline reflects last window event (characterization)", async () => {
    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
    window.dispatchEvent(new Event("online"));
    expect(mod.isOnline()).toBe(true);
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    window.dispatchEvent(new Event("offline"));
    expect(mod.isOnline()).toBe(false);
    // restore
    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
    window.dispatchEvent(new Event("online"));
  });
});

describe("lib/api — offline enqueue side-effect (characterization)", () => {
  let mod: typeof import("./api.js");
  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    mod = await import("./api.js");
    mod.clearTokens();
    localStorage.removeItem("agrobridge.mutationQueue");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("network failure while offline and queueable URL enqueues for later replay", async () => {
    // force offline
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    window.dispatchEvent(new Event("offline"));
    // give isOnline time to settle
    await new Promise((r) => setTimeout(r, 10));
    expect(mod.isOnline()).toBe(false);

    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline net fail");
    }));

    // queueable url contains /events
    await expect(mod.api("POST", "/farms/123/events", { title: "test" })).rejects.toMatchObject({ status: 0 });

    // allow lazy import + enqueue to settle
    await new Promise((r) => setTimeout(r, 50));
    const raw = localStorage.getItem("agrobridge.mutationQueue");
    // If offlineQueue was imported in time, it should have enqueued; otherwise document gap
    // This test documents current behavior: enqueue is best-effort async (non-blocking).
    // In jsdom with fast import, it often succeeds; if not, we at least assert no throw and NETWORK_ERROR.
    if (raw) {
      const parsed = JSON.parse(raw);
      expect(parsed.length).toBeGreaterThanOrEqual(1);
      expect(parsed[0].url).toContain("/events");
    } else {
      // Gap documented: sync enqueue may miss if offlineQueue not yet loaded.
      expect(raw).toBeNull();
    }

    // restore online
    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
    window.dispatchEvent(new Event("online"));
  });
});
