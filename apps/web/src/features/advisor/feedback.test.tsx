/**
 * E-W3 / A7-07: report-a-problem on a stored advisory.
 *
 * The Advisor chat list is local state and POST /ai/advisory returns no id, so
 * the report action attaches to the history rows (GET /ai/history) — the only
 * surface carrying row ids. These tests pin the POST body, the success toast
 * and the shared error mapping (404 → the app's "not found" copy), through the
 * real dialog/toast infrastructure the app ships.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

// Same framer-motion pass-through as components/ui.test.tsx: jsdom never
// finishes AnimatePresence exit animations, so a dismissed toast would linger.
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
  // `m` is what ui.tsx renders (the app root provides features via LazyMotion).
  return { motion, m: motion, LazyMotion: Pass, domAnimation: {}, AnimatePresence: Pass, MotionConfig: Pass, useReducedMotion: () => false };
});

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

// Spread the real module (the dialog's error mapping needs the real ApiError
// class for `instanceof`) and replace only the transport.
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});
vi.mock("../../lib/session", () => ({
  useSession: () => ({ session: { lang: "en", fullName: "Test Farmer", role: "FARMER" } }),
}));

import { ApiError } from "../../lib/api";
import { ToastProvider } from "../../components/ui";
import Advisor from "./Advisor";

const HISTORY_ITEM = {
  id: "h1",
  question: "Rice leaves show blast lesions, what should I do?",
  answer: "Apply tricylazole only after confirming with an agronomist.",
  confidence: 0.8,
  lowConfidenceFlag: false,
  groundedRefs: ["blast"],
  feedbackReason: null,
  feedbackAt: null,
  createdAt: "2026-10-17T10:00:00.000Z",
};

function mount(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return { unmount: () => act(() => root.unmount()) };
}

function findButton(text: string): HTMLButtonElement {
  const btn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").trim() === text);
  expect(btn, `no button labelled "${text}"`).toBeTruthy();
  return btn as HTMLButtonElement;
}

/** React 18's value tracker swallows a plain `.value = …` assignment; set through
 *  the prototype setter so the controlled textarea's onChange fires. */
function setTextareaValue(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/** GETs are shared by both cases; the POST outcome is set per test. */
function mockApi(postOutcome: () => Promise<unknown>) {
  apiMock.mockImplementation((method: string, path: string) => {
    if (method === "GET" && path === "/disease/cases") return Promise.resolve([]);
    if (method === "GET" && path === "/ai/history") return Promise.resolve([{ ...HISTORY_ITEM }]);
    if (method === "POST" && path === "/ai/history/h1/feedback") return postOutcome();
    return Promise.reject(new Error(`unexpected call: ${method} ${path}`));
  });
}

/** Opens the history panel, the report dialog, types a reason and submits. */
async function submitReport(reason: string) {
  await act(async () => {}); // flush the two resource reads
  await act(async () => {
    findButton("Past advisory history").click();
  });
  await act(async () => {
    findButton("Report an issue about this answer").click();
  });
  const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
  expect(textarea, "the report dialog did not render its reason field").toBeTruthy();
  await act(async () => {
    setTextareaValue(textarea!, reason);
  });
  await act(async () => {
    findButton("Send report").click();
  });
  await act(async () => {});
}

beforeEach(() => {
  document.body.innerHTML = "";
  apiMock.mockReset();
  // jsdom does not implement this; the chat's auto-scroll effect calls it.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("features/advisor — report-a-problem (A7-07)", () => {
  it("POSTs the reason for the row and reflects the recorded report", async () => {
    mockApi(() =>
      Promise.resolve({ id: "h1", feedbackReason: "Wrong dosage", feedbackAt: "2026-10-18T12:00:00.000Z" })
    );
    const mounted = mount(React.createElement(ToastProvider, null, React.createElement(Advisor)));
    await submitReport("Wrong dosage");

    expect(apiMock).toHaveBeenCalledWith("POST", "/ai/history/h1/feedback", { reason: "Wrong dosage" });
    // Success toast (exact product copy) and the row flips to its reported state.
    expect(document.body.textContent).toContain("Thanks — the report was recorded.");
    expect(document.body.textContent).toContain("Reported");
    expect(document.body.textContent).not.toContain("Report an issue about this answer");
    mounted.unmount();
  }, 15_000);

  it("maps a failed report through the shared error mapping and keeps the dialog open", async () => {
    mockApi(() => Promise.reject(new ApiError(404, "NOT_FOUND", "Advisory not found")));
    const mounted = mount(React.createElement(ToastProvider, null, React.createElement(Advisor)));
    await submitReport("Advisory not mine");

    // Same mapping every other surface uses for a 404 (errNotFoundGeneric).
    expect(document.body.textContent).toContain("The requested item was not found.");
    expect(document.body.textContent).not.toContain("Thanks — the report was recorded.");
    // The dialog stays open with the field intact so the farmer can retry, and
    // the row keeps its unreported action (nothing was recorded).
    expect(document.querySelector("textarea")).toBeTruthy();
    expect(document.body.textContent).toContain("Report an issue about this answer");
    mounted.unmount();
  }, 15_000);
});
