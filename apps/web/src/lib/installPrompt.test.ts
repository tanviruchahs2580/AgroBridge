/**
 * The install affordance is driven by the browser's own event, never by a guess
 * about what Chrome will do.
 *
 * Chrome was not offering the install prompt on the live site even though the
 * manifest meets every current criterion, so the app captures
 * `beforeinstallprompt` itself and shows a control only while that event is
 * held. These tests drive the real hook through raw react-dom/client + act (no
 * testing-library in this repo, mirroring lib/publicLanguage.test.tsx) and pin
 * the four states the button must have: hidden before any event, visible after
 * one, hidden when the page already runs installed, cleared once used.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useInstallPrompt } from "./installPrompt";
import type { InstallPrompt } from "./installPrompt";

/** The hook's latest return value, captured from the probe's render. */
let latest: InstallPrompt | null = null;

function Probe() {
  latest = useInstallPrompt();
  return React.createElement("div", null, latest.canInstall ? "installable" : "hidden");
}

function state(): InstallPrompt {
  if (!latest) throw new Error("probe not mounted");
  return latest;
}

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(React.createElement(Probe));
  });
  return {
    text: () => host.textContent,
    unmount: () => act(() => root.unmount()),
  };
}

/**
 * Dispatch the event Chrome fires when the app becomes installable.
 * `Object.assign` (not a cast) gives the plain Event exactly the two members a
 * real BeforeInstallPromptEvent carries for this module.
 */
function fireBeforeInstallPrompt(outcome: "accepted" | "dismissed" = "accepted") {
  const prompt = vi.fn(async () => {});
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome, platform: "web" }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return { event, prompt };
}

function fireAppInstalled() {
  act(() => {
    window.dispatchEvent(new Event("appinstalled"));
  });
}

beforeEach(() => {
  latest = null;
  document.body.innerHTML = "";
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("useInstallPrompt — the button exists only while the browser offers a prompt", () => {
  it("is hidden before any beforeinstallprompt, and prompting is a no-op", async () => {
    const mounted = mount();
    expect(state().canInstall).toBe(false);
    expect(state().installed).toBe(false);
    expect(mounted.text()).toBe("hidden");

    // No captured event: calling through must resolve quietly, not throw or
    // pretend something happened.
    await act(async () => {
      await state().promptInstall();
    });
    expect(state().canInstall).toBe(false);
    mounted.unmount();
  });

  it("appears after beforeinstallprompt and suppresses Chrome's own mini-infobar", () => {
    const mounted = mount();
    const { event } = fireBeforeInstallPrompt();

    expect(event.defaultPrevented, "the captured event must be preventDefault()ed").toBe(true);
    expect(state().canInstall).toBe(true);
    expect(mounted.text()).toBe("installable");
    mounted.unmount();
  });

  it("stays hidden when the page already runs installed (display-mode: standalone)", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(display-mode: standalone)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

    const mounted = mount();
    expect(state().installed).toBe(true);

    // Even a stray event cannot offer to install an already-installed app.
    fireBeforeInstallPrompt();
    expect(state().canInstall).toBe(false);
    expect(mounted.text()).toBe("hidden");
    mounted.unmount();
  });

  it("clears the event after promptInstall — the control is one shot", async () => {
    const mounted = mount();
    const { prompt } = fireBeforeInstallPrompt();
    expect(state().canInstall).toBe(true);

    await act(async () => {
      await state().promptInstall();
    });

    expect(prompt).toHaveBeenCalledTimes(1);
    expect(state().canInstall).toBe(false);
    expect(mounted.text()).toBe("hidden");

    // A second attempt must not call prompt() on the spent event (Chrome throws
    // on reuse).
    await act(async () => {
      await state().promptInstall();
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    mounted.unmount();
  });

  it("clears the pending event on appinstalled", () => {
    const mounted = mount();
    fireBeforeInstallPrompt();
    expect(state().canInstall).toBe(true);

    fireAppInstalled();

    expect(state().installed).toBe(true);
    expect(state().canInstall).toBe(false);
    expect(mounted.text()).toBe("hidden");
    mounted.unmount();
  });
});
