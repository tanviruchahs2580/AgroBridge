/**
 * The application shell (F-29 — App.tsx was 380 lines at 0% coverage).
 *
 * App.tsx owns the routing table, the signed-in chrome (header, nav, skip link,
 * theme + language toggles), the per-route document title and the guest/authed
 * split. The behaviours pinned here are the ones with meaning beyond markup:
 * a guest hitting a protected route lands on /login, an authed user never sees
 * /login, an unknown path renders the 404 with the app-name title, the language
 * control's accessible name contains its visible text (WCAG 2.5.3, F-34), and
 * clicking a nav link re-titles the document.
 *
 * The lazy route chunk for Home is stubbed: this file is about the shell, not
 * about Home (which has its own tests through features/home/*).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

const mockTrack = vi.fn();
vi.mock("./lib/analytics", () => ({ track: (...a: unknown[]) => mockTrack(...a) }));

let mockSession: { userId: string; fullName: string; role: string; lang: "bn" | "en"; district: string | null } | null = null;
let mockDark = false;
const mockToggleDark = vi.fn();
const mockSetLang = vi.fn();
vi.mock("./lib/session", () => ({
  useSession: () => ({
    session: mockSession,
    loading: false,
    dark: mockDark,
    refresh: async () => {},
    logout: () => {},
    endSession: () => {},
    setLang: (...a: unknown[]) => mockSetLang(...a),
    toggleDark: () => mockToggleDark(),
  }),
}));

let mockOnline = true;
vi.mock("./lib/api", async () => {
  const actual = await vi.importActual<typeof import("./lib/api")>("./lib/api");
  return {
    ...actual,
    api: async () => ({}),
    isOnline: () => mockOnline,
    onOnlineStatusChange: () => () => {},
    wakeBackend: () => {},
  };
});

vi.mock("./lib/offlineQueue", () => ({
  flushAll: async () => {},
  onDrop: () => () => {},
  onSync: () => () => {},
  onStorageError: () => () => {},
  onEnqueue: () => () => {},
  dropToastMessage: () => "",
  syncToastMessage: () => "",
  size: () => 0,
  subscribe: () => () => {},
}));

vi.mock("./features/home/Home", () => ({ default: () => React.createElement("p", null, "HOME_STUB") }));

import App from "./App";
import { dict, t } from "./lib/i18n";

const mountedRoots: { unmount: () => void }[] = [];

function mount(initialPath: string): { unmount: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(
        MemoryRouter,
        { initialEntries: [initialPath] },
        React.createElement(App)
      ) as ReactElement
    );
  });
  let alive = true;
  const unmount = () => {
    if (!alive) return;
    alive = false;
    act(() => root.unmount());
    container.remove();
  };
  mountedRoots.push({ unmount });
  return { unmount };
}

/** Let Suspense + effects (and any lazy import) settle. */
async function flush(times = 3) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const authedFarmer = { userId: "u1", fullName: "করিম", role: "FARMER", lang: "bn" as const, district: "রংপুর" };

/**
 * The language control: its visible text and its accessible name. Both the
 * public LangToggle and the shell toggle render the other language as their
 * visible label, so "EN"/"বাং" identifies either.
 */
function langToggle(): { visible: string; name: string } {
  const hit = Array.from(document.querySelectorAll("button")).find((b) => ["EN", "বাং"].includes((b.textContent ?? "").trim()));
  if (!hit) throw new Error("no language toggle rendered");
  return { visible: (hit.textContent ?? "").trim(), name: hit.getAttribute("aria-label") ?? "" };
}

beforeEach(() => {
  mockSession = null;
  mockDark = false;
  mockOnline = true;
  mockTrack.mockClear();
  mockToggleDark.mockClear();
  mockSetLang.mockClear();
  sessionStorage.clear();
  // Suppress the splash overlay: it is covered by its own suite, and its timers
  // would otherwise race every assertion here.
  sessionStorage.setItem("agro_splash_done", "1");
  document.body.innerHTML = "";
  document.title = "";
});

afterEach(() => {
  while (mountedRoots.length) mountedRoots.pop()!.unmount();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("App — the fixed bottom nav cannot cover page content (measured defect, 2026-11-12)", () => {
  it("the main landmark clears the nav on every safe-area inset", async () => {
    // On an Android device with a gesture bar, BottomNav grows by
    // env(safe-area-inset-bottom) while #main kept a flat pb-24 — measured with
    // CDP safe-area emulation at 390×844: 36px of Home's last panel sat
    // permanently behind the nav at a 48px inset. The clearance must therefore
    // carry the same inset term the nav does.
    mockSession = authedFarmer;
    mount("/");
    await flush();

    const main = document.getElementById("main");
    expect(main).toBeTruthy();
    const cls = main!.className;
    // The inset term is present in the mobile padding…
    expect(cls).toContain("env(safe-area-inset-bottom)");
    // …with no bare pb-24 left to compete with it, and the desktop reset intact
    // (the nav is hidden from `md` up, so a desktop gutter would be a regression).
    expect(cls).not.toContain("pb-24");
    expect(cls).toContain("md:pb-5");
  });
});

describe("App — the header wordmark is never truncated (measured defect, 2026-11-12)", () => {
  it("the brand does not shrink and the header row can wrap", async () => {
    // The brand sat `min-w-0` inside a non-wrapping `justify-between` row, so it
    // absorbed all of the control cluster's width pressure and `truncate` painted
    // a real ellipsis — "AgroBrid…" — below 412px (390: 77/78, 375: 73/78,
    // 360: 69/78, 320: 59/78). Width, not leading: forcing `line-height:1` left
    // the numbers unchanged. The fix is the same shape the control cluster
    // already uses — let the row wrap, and stop the brand from shrinking.
    mockSession = authedFarmer;
    mount("/");
    await flush();

    const row = document.querySelector("header > div");
    expect(row).toBeTruthy();
    expect(row!.className).toContain("flex-wrap");

    const brand = row!.firstElementChild as HTMLElement;
    expect(brand.className).toContain("shrink-0");
    // The wordmark still asks for `truncate` — that is the safety net if the name
    // ever outgrows the row again. It must simply have room, which `shrink-0`
    // guarantees by moving the pressure to the cluster that can wrap.
    expect(brand.querySelector(".truncate")?.textContent).toBe(dict.appName.bn);
  });
});

describe("App — routing and guards (F-29)", () => {
  it("sends a guest from a protected route to /login and renders the sign-in form", async () => {
    mount("/farm");
    await flush();

    // The Login form is the eager public route (its phone field is the marker).
    expect(document.querySelector("#phone")).toBeTruthy();
    expect(document.body.textContent).toContain(dict.login.bn);
    // The redirect lands on /login, so that route's title wins the effect.
    expect(document.title).toBe(`${t("login", "bn")} · ${t("appName", "bn")}`);
  });

  it("a signed-in user is bounced off /login back to the app", async () => {
    mockSession = authedFarmer;
    mount("/login");
    await flush();

    expect(document.body.textContent).toContain("HOME_STUB");
    expect(document.body.textContent).not.toContain(dict.login.bn);
  });

  it("an unknown path renders the 404 with the app-name title and a way home", async () => {
    mockSession = authedFarmer;
    mount("/no-such-page");
    await flush();

    expect(document.body.textContent).toContain(dict.notFoundTitle.bn);
    // No ROUTE_TITLES entry → the product alone names the window.
    expect(document.title).toBe(dict.appName.bn);
    const home = Array.from(document.querySelectorAll("a")).find((a) => a.textContent?.includes(dict.backHome.bn));
    expect(home?.getAttribute("href")).toBe("/");
  });
});

describe("App — signed-in shell (F-29) and the language control's name (F-34)", () => {
  it("renders the chrome, the nav labels and the skip link to #main", async () => {
    mockSession = authedFarmer;
    mount("/");
    await flush();

    expect(document.body.textContent).toContain(dict.appName.bn);
    expect(document.body.textContent).toContain(dict.myFarm.bn);
    expect(document.body.textContent).toContain(dict.market.bn);
    // Nav landmarks carry their bilingual accessible names.
    expect(document.querySelector(`nav[aria-label="${t("primaryNavAria", "bn")}"]`)).toBeTruthy();
    expect(document.querySelector(`nav[aria-label="${t("sidebarNavAria", "bn")}"]`)).toBeTruthy();
    // Skip link targets the main landmark it is meant to skip to.
    const skip = Array.from(document.querySelectorAll("a")).find((a) => a.textContent?.includes(dict.skipToContent.bn));
    expect(skip?.getAttribute("href")).toBe("#main");
    expect(document.getElementById("main")).toBeTruthy();
    expect(document.title).toBe(`${t("home", "bn")} · ${t("appName", "bn")}`);
  });

  it("the theme toggle reports the painted state and drives it", async () => {
    mockSession = authedFarmer;
    mockDark = true;
    mount("/");
    await flush();

    const toggle = document.querySelector(`button[aria-label="${t("themeToggleAria", "bn")}"]`);
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => {
      (toggle as HTMLButtonElement).click();
    });
    expect(mockToggleDark).toHaveBeenCalledTimes(1);
  });

  it("the offline banner appears only when the browser reports offline", async () => {
    mockSession = authedFarmer;
    mockOnline = false;
    mount("/");
    await flush();
    expect(document.body.textContent).toContain(dict.offlineBanner.bn);
  });

  it("the language toggle's accessible name starts with the text it shows (WCAG 2.5.3)", async () => {
    mockSession = authedFarmer;
    mount("/");
    await flush();

    // The shell toggle flips the session language.
    const shellToggle = langToggle();
    expect(shellToggle.name.startsWith(shellToggle.visible)).toBe(true);
    await act(async () => {
      const hit = Array.from(document.querySelectorAll("button")).find((b) => ["EN", "বাং"].includes((b.textContent ?? "").trim()));
      (hit as HTMLButtonElement).click();
    });
    expect(mockSetLang).toHaveBeenCalledWith("en");
  });

  it("the public language toggle satisfies the same rule for guests (F-34)", async () => {
    mockSession = null;
    // The public toggle lives on the auth shell, so a guest on /login is the
    // surface that renders it (the 404 renders no toggle).
    mount("/login");
    await flush();

    const toggle = langToggle();
    expect(toggle.visible.length).toBeGreaterThan(0);
    expect(toggle.name.startsWith(toggle.visible)).toBe(true);
    // The action half is still announced, after the visible name.
    expect(toggle.name).toContain(t("langSwitchAria", "bn"));
  });
});
