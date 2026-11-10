/**
 * Advisor photo upload — the outcome is a state tag, not a localized string
 * (folded audit item).
 *
 * The upload result used to be a message string, with the render deciding
 * "success vs error" by comparing that string to `t("pendingReview", lang)`.
 * Switching the UI language between the upload and the next paint changed the
 * right-hand side of the comparison, so the green "pending expert review" box
 * turned into a red error banner showing the same sentence. This test performs
 * exactly that journey: upload in English, switch to Bengali, assert the box is
 * still the success status and never an alert.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("framer-motion", async () => {
  const ReactMod = await import("react");
  const STRIP = new Set([
    "initial", "animate", "exit", "transition", "whileHover", "whileTap",
    "whileFocus", "variants", "layout", "layoutId", "drag", "onAnimationComplete",
  ]);
  const cache = new Map<string, React.ComponentType<Record<string, unknown>>>();
  const passthrough = (tag: string) => {
    const cached = cache.get(tag);
    if (cached) return cached;
    const Comp = ({ children, ...rest }: { children?: React.ReactNode } & Record<string, unknown>) => {
      const domProps: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rest)) if (!STRIP.has(k)) domProps[k] = v;
      return ReactMod.createElement(tag, domProps, children);
    };
    cache.set(tag, Comp);
    return Comp;
  };
  const motion = new Proxy({}, { get: (_target, key: string) => passthrough(key) });
  const Pass = ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children);
  return { motion, m: motion, LazyMotion: Pass, domAnimation: {}, AnimatePresence: Pass, MotionConfig: Pass, useReducedMotion: () => false };
});

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock("../../lib/analytics", () => ({ track: () => {} }));

/** The UI language the mocked session reports; flipped mid-test. */
let mockLang: "bn" | "en" = "en";
vi.mock("../../lib/session", () => ({
  useSession: () => ({ session: { lang: mockLang, fullName: "Test Farmer", role: "FARMER" } }),
}));

import { ToastProvider } from "../../components/ui";
import { dict } from "../../lib/i18n";
import Advisor from "./Advisor";

function mountAdvisor() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = () =>
    act(() => {
      root.render(React.createElement(ToastProvider, null, React.createElement(Advisor)));
    });
  render();
  return {
    rerenderWithLang: (lang: "bn" | "en") => {
      mockLang = lang;
      render();
    },
    unmount: () => act(() => root.unmount()),
  };
}

beforeEach(() => {
  mockLang = "en";
  document.body.innerHTML = "";
  apiMock.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("features/advisor — upload status survives a language switch", () => {
  it("keeps the pending-review box as a success status when the UI language changes mid-flight", async () => {
    apiMock.mockImplementation((method: string, path: string) => {
      if (method === "GET" && path === "/disease/cases") return Promise.resolve([]);
      if (method === "GET" && path === "/ai/history") return Promise.resolve([]);
      if (method === "POST" && path === "/disease/cases") return Promise.resolve({ id: "c1", status: "PENDING_REVIEW" });
      return Promise.reject(new Error(`unexpected call: ${method} ${path}`));
    });

    const view = mountAdvisor();
    await act(async () => {}); // flush the two resource reads

    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input, "the photo-upload input did not render").toBeTruthy();
    const file = new File([new Uint8Array([1, 2, 3])], "crop.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });

    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {});

    expect(apiMock).toHaveBeenCalledWith("POST", "/disease/cases", expect.any(FormData));
    expect(document.body.textContent).toContain(dict.pendingReview.en);
    expect(document.querySelector('[role="alert"]')).toBeNull();

    // The same farmer switches the UI to Bengali while the status is on screen.
    view.rerenderWithLang("bn");

    // The box is still the PENDING_REVIEW status, in the new language — it is not
    // re-classified as a failure just because the localized string changed.
    expect(document.body.textContent).toContain(dict.pendingReview.bn);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    view.unmount();
  });

  it("an over-size photo is an error in the current language, not a success box", async () => {
    apiMock.mockImplementation((method: string, path: string) => {
      if (method === "GET" && path === "/disease/cases") return Promise.resolve([]);
      if (method === "GET" && path === "/ai/history") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected call: ${method} ${path}`));
    });

    const view = mountAdvisor();
    await act(async () => {});

    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    const big = new File([new Uint8Array(8 * 1024 * 1024 + 1)], "big.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { value: [big], configurable: true });
    await act(async () => {
      input?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(document.body.textContent).toContain(dict.imageTooLarge.en);
    expect(document.querySelector('[role="alert"]')).toBeTruthy();
    // The oversize file never reached the API.
    expect(apiMock.mock.calls.some((c) => c[0] === "POST")).toBe(false);
    view.unmount();
  }, 15_000);
});
