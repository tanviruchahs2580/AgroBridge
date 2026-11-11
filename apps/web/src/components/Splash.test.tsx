/**
 * Splash overlay (F-29 — 0% coverage) and the shared public-language key.
 *
 * `staticOnly` is the reduced-motion / test path: no timers, no animation, the
 * branded frame and the ready line. The language comes from the storage key the
 * public screens own (`PUBLIC_LANG_KEY`) — this file used to repeat that literal,
 * so a rename in lib/publicLanguage.tsx would have silently split the splash from
 * the login page it hands over to.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";

vi.mock("../../lib/session", () => ({
  useSession: () => ({ session: null, loading: false, dark: false, refresh: async () => {}, logout: () => {}, endSession: () => {}, setLang: () => {}, toggleDark: () => {} }),
}));

import { Splash } from "./Splash";
import { dict } from "../lib/i18n";
import { PUBLIC_LANG_KEY } from "../lib/publicLanguage";

/**
 * Roots mounted by the current test. Tracked so a failing assertion still tears
 * the tree down: a leaked mount keeps its useResource subscription alive, and the
 * next test in the file then sees an invalidate refetch from the previous test's
 * component (observed as an extra GET in the request log).
 */
const mountedRoots: { unmount: () => void }[] = [];

function mount(node: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
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

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  while (mountedRoots.length) mountedRoots.pop()!.unmount();
  document.body.innerHTML = "";
});
afterEach(() => {
  localStorage.clear();
});

describe("components/Splash — static frame (F-29)", () => {
  it("renders the brand, the ready status and a progress announcement in Bengali by default", () => {
    const { unmount } = mount(<Splash staticOnly />);
    const splash = document.querySelector('[data-testid="splash"]');
    expect(splash).toBeTruthy();
    expect(splash!.textContent).toContain(dict.appName.bn);
    expect(splash!.textContent).toContain(dict.splashStatusReady.bn);
    unmount();
  });

  it("reads the language the public screens stored, not a private copy of the key", () => {
    localStorage.setItem(PUBLIC_LANG_KEY, "en");
    const { unmount } = mount(<Splash staticOnly />);
    const splash = document.querySelector('[data-testid="splash"]');
    // The EN dictionary, from the one storage key lib/publicLanguage exports.
    expect(splash!.textContent).toContain(dict.appName.en);
    expect(splash!.textContent).toContain(dict.splashStatusReady.en);
    expect(localStorage.getItem(PUBLIC_LANG_KEY)).toBe("en");
    unmount();
  });

  it("auto-dismisses the static frame through onDone", async () => {
    const onDone = vi.fn();
    const { unmount } = mount(<Splash staticOnly onDone={onDone} />);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1400));
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    unmount();
  });
});
