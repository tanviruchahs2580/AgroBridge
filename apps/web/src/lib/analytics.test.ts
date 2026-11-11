/**
 * lib/analytics — batch ownership.
 *
 * The endpoint derives the user from the bearer token, so a batch carries no
 * identity of its own. That made a buffer that outlived its session a real
 * privacy defect: events buffered while farmer A was signed in (route paths
 * included) were flushed under the NEXT account's token on the same device.
 * The fix keys the buffer to the token's existence: sign-out (the manager emits
 * with empty tokens) drops the buffer and its timer, while a token ROTATION —
 * which also emits, but with a live token — must not.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Tokens = { accessToken: string; refreshToken: string };
let tokens: Tokens = { accessToken: "at-1", refreshToken: "rt-1" };
let listeners: ((payload: { tokens: Tokens; session: unknown }) => void)[] = [];

vi.mock("./sessionManager.js", () => ({
  getTokens: () => tokens,
  onChange: (cb: (payload: { tokens: Tokens; session: unknown }) => void) => {
    listeners.push(cb);
    return () => {
      listeners = listeners.filter((l) => l !== cb);
    };
  },
}));

vi.mock("./api.js", async () => {
  const actual = await vi.importActual<typeof import("./api.js")>("./api.js");
  return { ...actual, API_BASE: "/api/v1", refreshAccessToken: async () => true };
});

const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));

/** Fresh module state (fresh buffer) with the mocked manager wired up. */
async function freshAnalytics(): Promise<typeof import("./analytics.js")> {
  vi.resetModules();
  listeners = [];
  return await import("./analytics.js");
}

function emitTokens(next: Tokens) {
  tokens = next;
  for (const cb of listeners) cb({ tokens: next, session: null });
}

beforeEach(() => {
  tokens = { accessToken: "at-1", refreshToken: "rt-1" };
  listeners = [];
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("lib/analytics — the buffer belongs to the session that produced it", () => {
  it("flushes a buffered batch under the live token (guard the gate)", async () => {
    const analytics = await freshAnalytics();
    analytics.track("route_view", { path: "/wallet" });

    await vi.advanceTimersByTimeAsync(6_000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(url)).toContain("/analytics/events");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer at-1");
    const body = JSON.parse(String(init.body)) as { events: { name: string }[] };
    expect(body.events[0]?.name).toBe("route_view");
  });

  it("drops the buffer when the session ends, so the next account cannot inherit it", async () => {
    const analytics = await freshAnalytics();
    analytics.track("route_view", { path: "/wallet" });

    // Sign-out as the session manager reports it: tokens gone, subscriber told.
    emitTokens({ accessToken: "", refreshToken: "" });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the buffer across a token rotation (the same user, a new access token)", async () => {
    const analytics = await freshAnalytics();
    analytics.track("advisory_asked");

    emitTokens({ accessToken: "at-2", refreshToken: "rt-2" });

    await vi.advanceTimersByTimeAsync(6_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer at-2");
  });
});
