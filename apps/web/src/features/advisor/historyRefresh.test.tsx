/**
 * Live-audit regression (2026-10-19): asking a question stores an advisory on
 * the server, but the collapsed "past advisories" panel kept the pre-question
 * fetch — the report-an-issue row for the new answer was invisible until a
 * reload. Submitting must invalidate the history resource.
 */
import { describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("framer-motion", async () => {
  const ReactMod = await import("react");
  const Pass = ({ children }: { children?: React.ReactNode }) => ReactMod.createElement(ReactMod.Fragment, null, children);
  const passthrough = (tag: string) => (props: Record<string, unknown>) => {
    const { children, initial, animate, exit, transition, whileHover, whileTap, layout, ...rest } = props as Record<string, unknown>;
    void initial; void animate; void exit; void transition; void whileHover; void whileTap; void layout;
    return ReactMod.createElement(tag, rest as never, children as never);
  };
  const motion = new Proxy({}, { get: (_t, key: string) => passthrough(key) });
  // `m` is what ui.tsx renders (the app root provides features via LazyMotion).
  return { motion, m: motion, LazyMotion: Pass, domAnimation: {}, AnimatePresence: Pass, MotionConfig: Pass, useReducedMotion: () => false };
});

const { apiMock, invalidateMock } = vi.hoisted(() => ({ apiMock: vi.fn(), invalidateMock: vi.fn() }));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock("../../lib/session", () => ({
  useSession: () => ({ session: { lang: "en", fullName: "Test Farmer", role: "FARMER" } }),
}));
vi.mock("../../lib/useResource", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/useResource")>();
  return { ...actual, invalidate: (key: string) => invalidateMock(key) };
});

import { ToastProvider } from "../../components/ui";
import Advisor from "./Advisor";

// jsdom has no layout; the chat auto-scroll effect needs the stub (same as feedback.test.tsx).
Element.prototype.scrollIntoView = vi.fn();

describe("advisor history refresh (live-audit finding)", () => {
  it("invalidates the history resource after a successful advisory", async () => {
    apiMock.mockImplementation((method: string, path: string) => {
      if (method === "POST" && path === "/ai/advisory") {
        return Promise.resolve({
          answer: "Check with an agronomist.",
          confidence: 0.7,
          provider: "offline-agro-engine",
          model: "kb-retrieval-v1",
          kbVersion: "abc123def456",
          lowConfidenceFlag: false,
          groundedRefs: [],
        });
      }
      if (method === "GET" && path === "/ai/history") return Promise.resolve([]);
      if (method === "GET" && path === "/disease/cases") return Promise.resolve([]);
      return Promise.resolve({});
    });

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        React.createElement(ToastProvider, null, React.createElement(Advisor))
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const input = host.querySelector("input[placeholder]") as HTMLInputElement;
    expect(input).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "Rice leaf spots — what should I do?");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = input.closest("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(invalidateMock).toHaveBeenCalledWith("advisor-history");
    await act(async () => root.unmount());
    host.remove();
  });
});
