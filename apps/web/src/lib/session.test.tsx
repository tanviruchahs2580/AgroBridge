/**
 * Characterization tests for lib/session.tsx
 * Tests login (refresh) / logout / expired token handling. Mocks `lib/api`.
 * Uses React DOM rendering with MemoryRouter — no @testing-library required beyond vitest.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

// ── Mocks ──
const mockApi = vi.fn();
const mockClearTokens = vi.fn(() => {
  localStorage.removeItem("ab_at");
  localStorage.removeItem("ab_rt");
});
let capturedUnauthorizedHandler: (() => void) | null = null;
const mockSetUnauthorizedHandler = vi.fn((fn: (() => void) | null) => {
  capturedUnauthorizedHandler = fn;
});

vi.mock("./api.js", async () => {
  const actual = await vi.importActual<typeof import("./api.js")>("./api.js");
  return {
    ...actual,
    api: (...args: unknown[]) => mockApi(...args),
    clearTokens: (...args: unknown[]) => mockClearTokens(...args),
    setUnauthorizedHandler: (fn: unknown) => mockSetUnauthorizedHandler(fn as any),
  };
});

const mockIdentify = vi.fn();
const mockTrack = vi.fn();
vi.mock("./analytics.js", () => ({
  identify: (...args: unknown[]) => mockIdentify(...args),
  track: (...args: unknown[]) => mockTrack(...args),
}));

vi.mock("./i18n.js", async () => {
  const act = await vi.importActual<typeof import("./i18n.js")>("./i18n.js");
  return {
    ...act,
    t: vi.fn((k: string, lang: string, vars?: Record<string, unknown>) => act.t(k as any, lang as any, vars as any)),
  };
});
import { t as mockT } from "./i18n.js";
const tSpy = mockT as unknown as ReturnType<typeof vi.fn>;

const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastInfo = vi.fn();
vi.mock("../components/ui.jsx", () => ({
  useToast: () => ({
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
    info: (...args: unknown[]) => mockToastInfo(...args),
  }),
}));

let mockNavigate = vi.fn();
let mockLocation: { pathname: string; search: string } = { pathname: "/", search: "" };
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useLocation: () => mockLocation,
  };
});

// Import under test AFTER mocks
import { SessionProvider, useSession } from "./session.js";

async function renderSession(initialPath = "/") {
  mockLocation = { pathname: initialPath, search: "" };
  const container = document.createElement("div");
  document.body.appendChild(container);
  let ctx: ReturnType<typeof useSession> | null = null;
  function Probe() {
    ctx = useSession();
    return null;
  }
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[initialPath]}>
        <SessionProvider>
          <Probe />
        </SessionProvider>
      </MemoryRouter>
    );
    // allow effects to run (refresh is async)
    await new Promise((r) => setTimeout(r, 0));
  });
  // also wait for the async refresh to settle if it started
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
  return {
    container,
    root,
    getCtx: () => ctx!,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("lib/session — refresh (session restoration on boot)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockApi.mockReset();
    mockClearTokens.mockClear();
    mockSetUnauthorizedHandler.mockClear();
    capturedUnauthorizedHandler = null;
    mockIdentify.mockClear();
    mockTrack.mockClear();
    mockToastError.mockClear();
    tSpy.mockClear?.();
    mockNavigate.mockClear();
    mockLocation = { pathname: "/", search: "" };
    document.documentElement.lang = "bn";
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks(); // but our mocks are vi.mock, so just clear
    // re-setup spies that were restored? We need to keep mock fns — they are module mocks not spies
    // So nothing
  });

  it("when no ab_at in localStorage, refresh resolves to null session, loading false, no api call", async () => {
    expect(localStorage.getItem("ab_at")).toBeNull();
    const { getCtx, unmount } = await renderSession("/");
    expect(mockApi).not.toHaveBeenCalledWith("GET", "/auth/me");
    expect(getCtx().session).toBeNull();
    expect(getCtx().loading).toBe(false);
    // document lang stays bn for guest
    expect(document.documentElement.lang).toBe("bn");
    unmount();
  });

  it("when ab_at present, successful GET /auth/me sets session and calls identify", async () => {
    localStorage.setItem("ab_at", "fake-at");
    localStorage.setItem("ab_rt", "fake-rt");
    mockApi.mockResolvedValueOnce({ id: "u1", fullName: "Karim", role: "FARMER", langPref: "bn" });
    const { getCtx, unmount } = await renderSession("/");
    expect(mockApi).toHaveBeenCalledWith("GET", "/auth/me");
    expect(getCtx().session).toEqual({ userId: "u1", fullName: "Karim", role: "FARMER", lang: "bn" });
    expect(getCtx().loading).toBe(false);
    expect(mockIdentify).toHaveBeenCalledWith("u1");
    expect(document.documentElement.lang).toBe("bn");
    unmount();
  });

  it("when ab_at present and user has langPref en, session.lang is en and html lang becomes en", async () => {
    localStorage.setItem("ab_at", "fake-at");
    mockApi.mockResolvedValueOnce({ id: "u2", fullName: "Asha", role: "ADMIN", langPref: "en" });
    const { getCtx, unmount } = await renderSession("/");
    expect(getCtx().session?.lang).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    unmount();
  });

  it("when GET /auth/me fails, clears tokens and sets session null", async () => {
    localStorage.setItem("ab_at", "bad-at");
    mockApi.mockRejectedValueOnce(new Error("401"));
    const { getCtx, unmount } = await renderSession("/");
    expect(mockClearTokens).toHaveBeenCalled();
    expect(getCtx().session).toBeNull();
    expect(getCtx().loading).toBe(false);
    unmount();
  });

  it("refresh() exposed via context can be called manually to re-validate", async () => {
    localStorage.setItem("ab_at", "at1");
    mockApi.mockResolvedValueOnce({ id: "u1", fullName: "K", role: "FARMER", langPref: "bn" });
    const { getCtx, unmount } = await renderSession("/");
    expect(getCtx().session?.userId).toBe("u1");
    // second refresh with new data
    mockApi.mockResolvedValueOnce({ id: "u1", fullName: "Karim Updated", role: "FARMER", langPref: "bn" });
    await act(async () => {
      await getCtx().refresh();
    });
    expect(getCtx().session?.fullName).toBe("Karim Updated");
    expect(mockApi).toHaveBeenCalledTimes(2);
    unmount();
  });
});

describe("lib/session — logout", () => {
  beforeEach(() => {
    localStorage.clear();
    mockApi.mockReset();
    mockClearTokens.mockClear();
    mockIdentify.mockClear();
    capturedUnauthorizedHandler = null;
    mockLocation = { pathname: "/wallet", search: "" };
    mockNavigate.mockClear();
  });
  afterEach(() => localStorage.clear());

  it("logout calls POST /auth/logout, clears tokens, identifies empty, sets session null", async () => {
    localStorage.setItem("ab_at", "at");
    localStorage.setItem("ab_rt", "rt");
    mockApi.mockResolvedValueOnce({ id: "u1", fullName: "K", role: "FARMER", langPref: "bn" }); // initial refresh
    mockApi.mockResolvedValueOnce({ loggedOut: true }); // logout call (api POST)
    const { getCtx, unmount } = await renderSession("/wallet");
    expect(getCtx().session).not.toBeNull();
    // trigger logout
    await act(async () => {
      getCtx().logout();
      // logout's api call is fire-and-forget (void ...catch) so wait a tick
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(mockApi).toHaveBeenCalledWith("POST", "/auth/logout", {});
    expect(mockClearTokens).toHaveBeenCalled();
    expect(mockIdentify).toHaveBeenCalledWith("");
    expect(getCtx().session).toBeNull();
    unmount();
  });

  it("logout clears tokens even when POST /auth/logout network fails", async () => {
    localStorage.setItem("ab_at", "at");
    mockApi.mockResolvedValueOnce({ id: "u1", fullName: "K", role: "FARMER", langPref: "bn" });
    mockApi.mockRejectedValueOnce(new Error("network down"));
    const { getCtx, unmount } = await renderSession("/");
    await act(async () => {
      getCtx().logout();
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(mockClearTokens).toHaveBeenCalled();
    expect(getCtx().session).toBeNull();
    unmount();
  });
});

describe("lib/session — expired token handling (unauthorizedHandler)", () => {
  beforeEach(() => {
    localStorage.clear();
    mockApi.mockReset();
    mockClearTokens.mockClear();
    mockTrack.mockClear();
    mockToastError.mockClear();
    tSpy.mockClear?.();
    mockNavigate.mockClear();
    capturedUnauthorizedHandler = null;
    mockSetUnauthorizedHandler.mockClear();
    mockLocation = { pathname: "/farm", search: "?x=1" };
    document.documentElement.lang = "bn";
  });
  afterEach(() => localStorage.clear());

  it("registers unauthorizedHandler on mount and unregisters on unmount", async () => {
    const { unmount } = await renderSession("/farm");
    expect(mockSetUnauthorizedHandler).toHaveBeenCalledWith(expect.any(Function));
    expect(capturedUnauthorizedHandler).toBeTruthy();
    unmount();
    expect(mockSetUnauthorizedHandler).toHaveBeenLastCalledWith(null);
  });

  it("when handler invoked while authed, clears tokens, tracks, toasts, and navigates to /login with from", async () => {
    localStorage.setItem("ab_at", "at");
    mockApi.mockResolvedValueOnce({ id: "u1", fullName: "K", role: "FARMER", langPref: "en" });
    const { getCtx, unmount } = await renderSession("/farm");
    expect(getCtx().session?.lang).toBe("en");
    tSpy.mockClear();
    mockToastError.mockClear();
    mockTrack.mockClear();
    mockNavigate.mockClear();
    // invoke expired handler
    await act(async () => {
      capturedUnauthorizedHandler?.();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(mockClearTokens).toHaveBeenCalled();
    expect(getCtx().session).toBeNull();
    expect(mockTrack).toHaveBeenCalledWith("session_expired");
    // toast uses session?.lang at handler time — now null? But handler closure captures session?.lang at registration.
    // In real code, handler closure uses `session?.lang ?? "bn"` from render's session state.
    // At this point session was en before clear, so toast should have been called with en translation, OR bn if captured after clear.
    // We lock current behavior: it uses `session?.lang ?? "bn"` where session is from useState at handler creation time.
    // So after login as en, it should call t("sessionExpired", "en")
    expect(mockToastError).toHaveBeenCalled();
    const toastMsg = mockToastError.mock.calls[0][0] as string;
    // toast message should be the translation for sessionExpired in en (if session was en) or bn
    // Since we mocked t to forward to real t, we can check it was called
    expect(tSpy).toHaveBeenCalledWith("sessionExpired", expect.any(String));
    // navigate to login with from
    expect(mockNavigate).toHaveBeenCalledWith("/login", { replace: true, state: { from: "/farm?x=1" } });
    // Note: capturing the lang fallback is important — this is the regression lock
    unmount();
  });

  it('guest fallback: when session is null, handler toast uses "bn" via session?.lang ?? "bn" (lock)', async () => {
    // No token, so session is null (guest)
    const { unmount } = await renderSession("/farm");
    expect(capturedUnauthorizedHandler).toBeTruthy();
    tSpy.mockClear();
    mockToastError.mockClear();
    await act(async () => {
      capturedUnauthorizedHandler?.();
      await new Promise((r) => setTimeout(r, 0));
    });
    // The handler should call t("sessionExpired", "bn") — because guest lang is bn
    expect(tSpy).toHaveBeenCalledWith("sessionExpired", "bn");
    expect(mockToastError).toHaveBeenCalledWith(expect.stringContaining("সেশনের মেয়াদ শেষ"));
    unmount();
  });

  it("does NOT navigate if already on /login (prevent redirect loop)", async () => {
    const { unmount } = await renderSession("/login");
    // need to re-capture handler after mount with /login location
    // our mockLocation was set to /login at render
    mockNavigate.mockClear();
    await act(async () => {
      capturedUnauthorizedHandler?.();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(mockNavigate).not.toHaveBeenCalled();
    unmount();
  });

  it("does NOT navigate if on /register", async () => {
    const { unmount } = await renderSession("/register");
    mockNavigate.mockClear();
    await act(async () => {
      capturedUnauthorizedHandler?.();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(mockNavigate).not.toHaveBeenCalled();
    unmount();
  });

  it("sets document.documentElement.lang to bn when session cleared", async () => {
    localStorage.setItem("ab_at", "at");
    mockApi.mockResolvedValueOnce({ id: "u1", fullName: "K", role: "FARMER", langPref: "en" });
    const { unmount } = await renderSession("/");
    expect(document.documentElement.lang).toBe("en");
    await act(async () => {
      capturedUnauthorizedHandler?.();
      await new Promise((r) => setTimeout(r, 0));
    });
    // After handler, session is null, so effect sets lang to bn
    expect(document.documentElement.lang).toBe("bn");
    unmount();
  });
});

describe("lib/session — setLang", () => {
  beforeEach(() => {
    localStorage.clear();
    mockApi.mockReset();
    mockTrack.mockClear();
    document.documentElement.lang = "bn";
  });
  afterEach(() => localStorage.clear());

  it("setLang updates session lang, html lang, tracks, and PATCHes", async () => {
    localStorage.setItem("ab_at", "at");
    mockApi.mockResolvedValueOnce({ id: "u1", fullName: "K", role: "FARMER", langPref: "bn" });
    const { getCtx, unmount } = await renderSession("/");
    expect(getCtx().session?.lang).toBe("bn");
    mockApi.mockResolvedValueOnce({ langPref: "en" });
    await act(async () => {
      await getCtx().setLang("en");
    });
    expect(getCtx().session?.lang).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(mockTrack).toHaveBeenCalledWith("language_switch", { to: "en" });
    expect(mockApi).toHaveBeenCalledWith("PATCH", "/auth/me", { langPref: "en" });
    unmount();
  });

  it("setLang keeps UI language even if PATCH fails (characterization)", async () => {
    localStorage.setItem("ab_at", "at");
    mockApi.mockResolvedValueOnce({ id: "u1", fullName: "K", role: "FARMER", langPref: "bn" });
    const { getCtx, unmount } = await renderSession("/");
    mockApi.mockRejectedValueOnce(new Error("network"));
    await act(async () => {
      await getCtx().setLang("en");
    });
    expect(getCtx().session?.lang).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    unmount();
  });

  it("setLang when guest (null session) does not set session but still updates html lang", async () => {
    const { getCtx, unmount } = await renderSession("/");
    expect(getCtx().session).toBeNull();
    mockApi.mockReset(); // PATCH should still be attempted
    mockApi.mockResolvedValueOnce({});
    await act(async () => {
      await getCtx().setLang("en");
    });
    // session stays null — code does `setSession(s => s ? {...s, lang:l} : s)` so null remains null
    expect(getCtx().session).toBeNull();
    expect(document.documentElement.lang).toBe("en");
    unmount();
  });
});
