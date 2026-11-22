/**
 * Characterization tests for lib/api.ts
 * Covers token storage, single-flight refresh, retry, timeout and unauthorized handling.
 * Mock fetch globally; no UI tested.
 * Vitest + jsdom assumed (localStorage, window, navigator).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
    sessionStorage.clear();
    // ensure module re-reads empty storage
    mod = await import("./api.js");
    mod.clearTokens();
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("setTokens persists both per-tab mirrors to sessionStorage — NEVER localStorage (SEC-02)", async () => {
    mod.setTokens("at-123", "rt-456");
    expect(sessionStorage.getItem("ab_at")).toBe("at-123");
    expect(sessionStorage.getItem("ab_rt")).toBe("rt-456");
    expect(localStorage.getItem("ab_at")).toBeNull();
    expect(localStorage.getItem("ab_rt")).toBeNull();
    expect(mod.hasToken()).toBe(true);
  });

  it("clearTokens removes the mirrors and hasToken becomes false", async () => {
    mod.setTokens("at-123", "rt-456");
    mod.clearTokens();
    expect(sessionStorage.getItem("ab_at")).toBeNull();
    expect(sessionStorage.getItem("ab_rt")).toBeNull();
    expect(localStorage.getItem("ab_at")).toBeNull();
    expect(localStorage.getItem("ab_rt")).toBeNull();
    expect(mod.hasToken()).toBe(false);
  });

  it("legacy localStorage tokens migrate to the new scheme at module load (SEC-02)", async () => {
    localStorage.setItem("ab_at", "preloaded-at");
    localStorage.setItem("ab_rt", "preloaded-rt");
    vi.resetModules();
    const fresh = await import("./api.js");
    // The refresh mirror moved to sessionStorage; the legacy keys are gone.
    expect(sessionStorage.getItem("ab_rt")).toBe("preloaded-rt");
    expect(localStorage.getItem("ab_at")).toBeNull();
    expect(localStorage.getItem("ab_rt")).toBeNull();
    // The stale AT copy is dropped on purpose: a fresh access token is minted
    // from the migrated refresh token at boot (session.tsx → refreshAccessToken).
    expect(fresh.hasToken()).toBe(false);
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
    expect(sessionStorage.getItem("ab_at")).toBe("a2");
    expect(sessionStorage.getItem("ab_rt")).toBe("r2");
  });
});

describe("lib/api — ApiError and envelope handling", () => {
  let mod: typeof import("./api.js");
  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
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
    sessionStorage.clear();
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
    sessionStorage.clear();
    mod = await import("./api.js");
    mod.clearTokens();
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("401 triggers single-flight refresh and retries once on success", async () => {
    mod.setTokens("expired-at", "valid-rt");
    const fetchMock = vi.fn(async (url: string, _opts: RequestInit) => {
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
    // SEC-02: the refreshed tokens land in the per-tab mirrors — the
    // localStorage token keys must stay empty forever (the audit acceptance).
    expect(sessionStorage.getItem("ab_at")).toBe("new-at");
    expect(sessionStorage.getItem("ab_rt")).toBe("new-rt");
    expect(localStorage.getItem("ab_at")).toBeNull();
    expect(localStorage.getItem("ab_rt")).toBeNull();
    expect(mod.hasToken()).toBe(true);
  });

  it("concurrent 401s share single refresh request (single-flight)", async () => {
    mod.setTokens("expired-at", "valid-rt");
    let refreshCount = 0;
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
    expect(sessionStorage.getItem("ab_rt")).toBeNull();
    expect(localStorage.getItem("ab_at")).toBeNull();
    expect(localStorage.getItem("ab_rt")).toBeNull();
    expect(mod.hasToken()).toBe(false);
    expect(handler).toHaveBeenCalledTimes(1);
    mod.setUnauthorizedHandler(null);
  });

  it("refresh 429 keeps the session: no clear, no unauthorizedHandler (SEC-01)", async () => {
    mod.setTokens("expired-at", "valid-rt");
    const handler = vi.fn();
    mod.setUnauthorizedHandler(handler);
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/auth/refresh")) {
        return errEnvelope(429, "RATE_LIMITED", "Too many session refreshes. Please try again shortly.");
      }
      return errEnvelope(401, "UNAUTHORIZED", "expired");
    });
    vi.stubGlobal("fetch", fetchMock);
    // A throttled refresh is "try again shortly", not a dead session: the
    // client surfaces a retryable 429 and the tokens stay in place.
    await expect(mod.api("GET", "/auth/me")).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect(sessionStorage.getItem("ab_rt")).toBe("valid-rt");
    expect(mod.hasToken()).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    mod.setUnauthorizedHandler(null);
  });

  it("refresh 5xx keeps the session too (transient, not dead)", async () => {
    mod.setTokens("expired-at", "valid-rt");
    const handler = vi.fn();
    mod.setUnauthorizedHandler(handler);
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/auth/refresh")) {
        return errEnvelope(503, "UNAVAILABLE", "overloaded");
      }
      return errEnvelope(401, "UNAUTHORIZED", "expired");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(mod.api("GET", "/auth/me")).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect(mod.hasToken()).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    mod.setUnauthorizedHandler(null);
  });

  it("apiBlob with a throttled refresh keeps the session (SEC-01 completeness)", async () => {
    mod.setTokens("expired-at", "valid-rt");
    const handler = vi.fn();
    mod.setUnauthorizedHandler(handler);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/auth/refresh")) {
        return errEnvelope(429, "RATE_LIMITED", "slow down");
      }
      return new Response("not allowed", { status: 401 });
    }));
    await expect(mod.apiBlob("/photos/x.jpg")).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect(mod.hasToken()).toBe(true);
    expect(handler).not.toHaveBeenCalled();
    mod.setUnauthorizedHandler(null);
  });

  it("refresh network failure is transient too — session survives a dead network", async () => {
    mod.setTokens("expired-at", "valid-rt");
    const handler = vi.fn();
    mod.setUnauthorizedHandler(handler);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/auth/refresh")) {
        throw new TypeError("Failed to fetch");
      }
      return errEnvelope(401, "UNAUTHORIZED", "expired");
    }));
    await expect(mod.api("GET", "/auth/me")).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect(mod.hasToken()).toBe(true);
    expect(handler).not.toHaveBeenCalled();
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

  it("no plausible session — immediate 401 clears tokens without any refresh call", async () => {
    mod.clearTokens();
    mod.setTokens("only-at", ""); // AT in memory, no refresh mirror, no cookie pair
    const fetchMock = vi.fn(async () => errEnvelope(401, "UNAUTHORIZED", "expired"));
    vi.stubGlobal("fetch", fetchMock);
    const h = vi.fn();
    mod.setUnauthorizedHandler(h);
    await expect(mod.api("GET", "/x")).rejects.toMatchObject({ status: 401 });
    // wasAuthed true before, so handler called, tokens cleared; the 401 flow
    // skipped the refresh entirely (neither transport had anything to send)
    expect(h).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    mod.setUnauthorizedHandler(null);
  });
  it("cookie-transport refresh sends the CSRF double-submit and no body token (SEC-02)", async () => {
    // No stored refresh token; the readable CSRF pair is present. The real
    // ab_rt is HttpOnly — it never appears in JS reach, this test only proves
    // the CLIENT's half of the double-submit contract.
    document.cookie = "ab_csrf=abc123def456abc123def456abc12345";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { accessToken: "at-c", refreshToken: "rt-c" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await mod.refreshAccessToken()).toBe(true);
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/auth/refresh");
    expect((opts.headers as Record<string, string>)["X-CSRF-Token"]).toBe("abc123def456abc123def456abc12345");
    expect(opts.credentials).toBe("include");
    expect(opts.body).toBe("{}");
    // The minted pair lands in the per-tab mirrors, never localStorage.
    expect(mod.hasToken()).toBe(true);
    expect(sessionStorage.getItem("ab_at")).toBe("at-c");
    expect(sessionStorage.getItem("ab_rt")).toBe("rt-c");
    expect(localStorage.getItem("ab_at")).toBeNull();
    document.cookie = "ab_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
  });

  it("cookie-transport refresh with no CSRF pair and no mirror is refused locally (no fetch)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await mod.refreshAccessToken()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hasPlausibleSession gates the boot refresh (SEC-02)", async () => {
    // Guest: nothing authenticates a refresh — no boot auth call.
    expect(mod.hasPlausibleSession()).toBe(false);
    // Any per-tab mirror present.
    mod.setTokens("", "rt-mirror");
    expect(mod.hasPlausibleSession()).toBe(true);
    mod.clearTokens();
    mod.setTokens("at-mirror", "");
    expect(mod.hasPlausibleSession()).toBe(true);
    mod.clearTokens();
    // Readable CSRF cookie present (the HttpOnly refresh cookie's pair).
    document.cookie = "ab_csrf=fedcba9876543210fedcba9876543210";
    expect(mod.hasPlausibleSession()).toBe(true);
    document.cookie = "ab_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
    expect(mod.hasPlausibleSession()).toBe(false);
  });
});

describe("lib/api — X-Request-Id correlation (I-01)", () => {
  let mod: typeof import("./api.js");
  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    mod = await import("./api.js");
    mod.clearTokens();
  });
  afterEach(() => vi.unstubAllGlobals());

  function headerOf(call: unknown[]): string | undefined {
    return ((call[1] as RequestInit).headers as Record<string, string>)["X-Request-Id"];
  }

  it("sends a non-empty X-Request-Id on every request", async () => {
    const fetchMock = vi.fn(async () => okData({ ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    await mod.api("GET", "/farms");
    await mod.api("POST", "/farms", { name: "x" });
    expect(headerOf(fetchMock.mock.calls[0])).toBeTruthy();
    expect(headerOf(fetchMock.mock.calls[1])).toBeTruthy();
  });

  it("keeps ONE id across the retries of a single logical request (500 → 502 → 200)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: {} }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, data: {} }), { status: 502 }))
      .mockResolvedValueOnce(okData({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    await mod.api("GET", "/products");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const ids = fetchMock.mock.calls.map((c) => headerOf(c));
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBe(ids[0]);
    expect(ids[2]).toBe(ids[0]);
  }, 10000);

  it("reuses the id for the replay after a silent token refresh (same logical request)", async () => {
    mod.setTokens("expired-at", "valid-rt");
    let guardedCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/auth/refresh")) {
        return new Response(JSON.stringify({ data: { accessToken: "new-at", refreshToken: "new-rt" } }), { status: 200 });
      }
      guardedCalls++;
      if (guardedCalls === 1) return errEnvelope(401, "UNAUTHORIZED", "expired");
      return okData({ id: "u1" });
    });
    vi.stubGlobal("fetch", fetchMock);
    await mod.api("GET", "/auth/me");
    const guarded = fetchMock.mock.calls.filter((c) => !String(c[0]).includes("/auth/refresh"));
    expect(guarded.length).toBe(2);
    // The replay is the same logical request — one id across both attempts.
    expect(headerOf(guarded[1])).toBe(headerOf(guarded[0]));
  });

  it("gives separate requests separate ids", async () => {
    const fetchMock = vi.fn(async () => okData({ ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    await mod.api("GET", "/a");
    await mod.api("GET", "/b");
    const id1 = headerOf(fetchMock.mock.calls[0]);
    const id2 = headerOf(fetchMock.mock.calls[1]);
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id2).not.toBe(id1);
  });

  it("carries an id on the token refresh request too", async () => {
    mod.setTokens("expired-at", "valid-rt");
    let guardedCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/auth/refresh")) {
        return new Response(JSON.stringify({ data: { accessToken: "new-at", refreshToken: "new-rt" } }), { status: 200 });
      }
      guardedCalls++;
      // 401 first so the silent refresh actually fires, then succeed on replay.
      return guardedCalls === 1 ? errEnvelope(401, "UNAUTHORIZED", "expired") : okData({ ok: 1 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await mod.api("GET", "/auth/me");
    const refreshCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/auth/refresh"));
    expect(refreshCall).toBeTruthy();
    expect(headerOf(refreshCall!)).toBeTruthy();
  });
});

describe("lib/api — isOnline / onOnlineStatusChange", () => {
  let mod: typeof import("./api.js");
  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
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
    sessionStorage.clear();
    mod = await import("./api.js");
    mod.clearTokens();
    localStorage.removeItem("agrobridge.mutationQueue");
    // Mirror the app's boot contract: App.tsx primes the queue module at
    // startup ("Prime offlineQueue lazy import for later sync enqueue") so
    // the failure path never lazy-loads it mid-error. Priming here keeps the
    // test deterministic under any module runner (vitest 4 could serve a
    // partial namespace for a lazily-imported cycle member; AUD-V3).
    await import("./offlineQueue.js");
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

    /**
     * The enqueue is asynchronous (the failure path imports the queue lazily), so
     * this waits for it — bounded, and it FAILS if the entry never appears.
     *
     * The previous version branched on whether the write happened and asserted the
     * matching outcome either way, so it passed however the race resolved and could
     * not detect the offline promise regressing. "A queueable write made offline is
     * retained" is the feature; a test that tolerates its absence is not a test of it.
     */
    let raw: string | null = null;
    for (let i = 0; i < 40 && !raw; i++) {
      await new Promise((r) => setTimeout(r, 25));
      raw = localStorage.getItem("agrobridge.mutationQueue");
    }
    expect(raw, "a queueable write made offline must be retained in the mutation queue").not.toBeNull();

    const parsed = JSON.parse(raw as string) as Array<{ url: string; method: string }>;
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    expect(parsed[0]!.url).toContain("/events");
    expect(parsed[0]!.method).toBe("POST");

    // restore online
    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
    window.dispatchEvent(new Event("online"));
  });
});

describe("lib/api — cross-tab refresh rotation (AUD-V3 M-3)", () => {
  let mod: typeof import("./api.js");
  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    mod = await import("./api.js");
    mod.clearTokens();
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  /**
   * Two tabs hitting 401 simultaneously both POST /auth/refresh with the
   * same refresh token; the server's rotation rejects the loser, which must
   * NOT log its tab out — the winner's tokens have already landed in storage
   * via BroadcastChannel/storage events. tryRefresh re-reads the stored
   * token after a failed attempt and retries once when it moved.
   */
  it("a refresh rejected because another tab rotated the family retries with the winner's token", async () => {
    mod.setTokens("at1", "rt1");
    const fetchMock = vi.fn(async (url: string, opts: RequestInit) => {
      if (String(url).includes("/auth/refresh")) {
        const body = JSON.parse(String(opts.body)) as { refreshToken: string };
        if (body.refreshToken === "rt1") {
          // The other tab wins the race while our request is in flight: its
          // rotation reaches this tab through the BroadcastChannel handler,
          // which lands the new tokens via setTokens (memory + per-tab mirror).
          mod.setTokens("at2", "rt2");
          return new Response(JSON.stringify({ ok: false, error: { code: "UNAUTHORIZED", message: "rotated" } }), { status: 401 });
        }
        if (body.refreshToken === "rt2") {
          return new Response(JSON.stringify({ data: { accessToken: "at3", refreshToken: "rt3" } }), { status: 200 });
        }
        return errEnvelope(400, "BAD_REQUEST", "unexpected token");
      }
      return okData({ id: "u1" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const okRefresh = await mod.refreshAccessToken();
    expect(okRefresh).toBe(true);
    expect(sessionStorage.getItem("ab_rt")).toBe("rt3");
    const refreshBodies = fetchMock.mock.calls
      .filter((c) => String(c[0]).includes("/auth/refresh"))
      .map((c) => (JSON.parse(String((c[1] as RequestInit).body)) as { refreshToken: string }).refreshToken);
    expect(refreshBodies).toEqual(["rt1", "rt2"]); // first lost, second adopted the winner
  });

  it("a refresh rejected with NO cross-tab rotation still fails honestly", async () => {
    mod.setTokens("at1", "rt1");
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: { code: "UNAUTHORIZED", message: "revoked" } }), { status: 401 })
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await mod.refreshAccessToken()).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1); // no pointless retry loop
  });
});

describe("lib/api — apiBlob goes through the shared transport (folded audit item)", () => {
  let mod: typeof import("./api.js");
  beforeEach(async () => {
    vi.resetModules();
    localStorage.clear();
    sessionStorage.clear();
    mod = await import("./api.js");
    mod.clearTokens();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns the response body as a Blob (the bytes never round-trip through JSON)", async () => {
    // The body is built from bytes and typed by the response header: the jsdom
    // environment's `Blob` and the runtime's `Response` are different realms, so
    // wrapping one in the other would silently stringify it.
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const fetchMock = vi.fn(
      async () => new Response(bytes, { status: 200, headers: { "Content-Type": "image/jpeg" } })
    );
    vi.stubGlobal("fetch", fetchMock);

    const blob = await mod.apiBlob("/disease/cases/c1/photo");

    expect(blob.size).toBe(bytes.byteLength);
    expect(blob.type).toBe("image/jpeg");
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([...bytes]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("times out through the shared 45s ceiling instead of hanging the viewer forever", async () => {
    // A request that never settles unless aborted: the old apiBlob called fetch
    // directly, so it had no timeout at all and its `instanceof NetworkError`
    // branches could never be taken.
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted.", "AbortError"))
          );
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();

    const pending = mod.apiBlob("/disease/cases/c1/photo");
    // Attach the rejection expectation BEFORE the abort fires, or the rejected
    // promise is unhandled for a tick and vitest reports it as a stray error.
    const outcome = expect(pending).rejects.toMatchObject({ status: 0, code: "NETWORK_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(45_000);
    await outcome;
  });

  it("maps a non-abort network failure to NETWORK_ERROR", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      })
    );
    await expect(mod.apiBlob("/disease/cases/c1/photo")).rejects.toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });
});
