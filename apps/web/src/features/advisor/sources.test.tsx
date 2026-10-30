/**
 * A3-01 / A4-09 (web side): a grounded answer renders its citations with the
 * resolved source TITLE (not the internal corpus id), the provenance class is
 * disclosed ("expert review pending" for UNSOURCED entries), and the review
 * marker survives into the chat transcript — this is the surface the farmer
 * actually reads.
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
vi.mock("../../lib/session", () => ({
  useSession: () => ({ session: { lang: "en", fullName: "Test Farmer", role: "FARMER" } }),
}));

import { ToastProvider } from "../../components/ui";
import Advisor from "./Advisor";

function findButton(text: string): HTMLButtonElement {
  const btn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === text);
  expect(btn, `no button labelled "${text}"`).toBeTruthy();
  return btn as HTMLButtonElement;
}

function setInputValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = "";
  apiMock.mockReset();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("features/advisor — resolved citations in the transcript (A3-01)", () => {
  it("renders the source title, never the raw corpus id, and discloses an unreviewed source", async () => {
    apiMock.mockImplementation((method: string, path: string) => {
      if (method === "GET" && path === "/disease/cases") return Promise.resolve([]);
      if (method === "GET" && path === "/ai/history") return Promise.resolve([]);
      if (method === "POST" && path === "/ai/advisory")
        return Promise.resolve({
          answer: "Apply urea in three splits.\n\n— Urea application schedule for rice",
          confidence: 0.88,
          provider: "offline-agro-engine",
          model: "kb-retrieval-v1",
          lowConfidenceFlag: false,
          groundedRefs: ["rice-urea"],
          groundedSources: [
            { id: "rice-urea", titleEn: "Urea application schedule for rice", crop: "rice", status: "UNSOURCED" },
          ],
          kbVersion: "0123456789ab",
        });
      return Promise.reject(new Error(`unexpected call: ${method} ${path}`));
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(React.createElement(ToastProvider, null, React.createElement(Advisor))));
    await act(async () => {}); // flush the two resource reads

    const input = document.querySelector<HTMLInputElement>("input[type='text']") ?? document.querySelector<HTMLInputElement>("input:not([type='file'])");
    expect(input, "the ask form did not render its question input").toBeTruthy();
    await act(async () => {
      setInputValue(input!, "When do I apply urea?");
    });
    await act(async () => {
      findButton("Send").click();
    });
    await act(async () => {}); // flush the POST

    const text = document.body.textContent ?? "";
    expect(text).toContain("Urea application schedule for rice");
    expect(text).not.toContain("· rice-urea");
    expect(text).toContain("expert review pending");
    // Provenance disclosure line still names the engine and KB version.
    expect(text).toContain("01234567");
    act(() => root.unmount());
  }, 15_000);
});
