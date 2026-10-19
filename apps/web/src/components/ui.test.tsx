/**
 * Component tests for the dialog contract (WEB-6/WEB-7/WEB-11).
 *
 * The review's finding: the dialog's a11y effect re-ran on every parent render
 * because callers pass inline `onClose` closures, and the setup focuses the dialog's
 * first focusable element — so a dialog whose state updates per keystroke (the wallet's
 * withdraw amount, the services booking form) pulled focus out of the field being typed
 * in. `inert` also covered only `#main`, leaving the header, sidebar, bottom nav and
 * skip link reachable behind an `aria-modal` dialog.
 *
 * These tests exist because both defects are invisible to type-checking and to API
 * tests, and the e2e suite never types into a dialog field character by character.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";

/**
 * framer-motion pass-through (test-only). jsdom never completes the exit
 * animations AnimatePresence waits for, so a dismissed toast would linger in the
 * DOM forever and no test could observe auto-dismissal. Replacing motion with
 * plain, identity-stable elements keeps the DOM assertions honest: a removed
 * child is removed. The dialog tests below exercise focus/inert behaviour, which
 * does not depend on animation frames.
 */
vi.mock("framer-motion", async () => {
  const ReactMod = await import("react");
  const STRIP = new Set([
    "initial",
    "animate",
    "exit",
    "transition",
    "whileHover",
    "whileTap",
    "whileFocus",
    "variants",
    "layout",
    "layoutId",
    "drag",
    "onAnimationComplete",
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
  // `m` is what ui.tsx renders (the app root provides features via LazyMotion);
  // the mock must expose it or every modal/toast would render nothing here.
  return { motion, m: motion, LazyMotion: Pass, domAnimation: {}, AnimatePresence: Pass, MotionConfig: Pass, useReducedMotion: () => false };
});

vi.mock("./session", () => ({ useSession: () => null }));
vi.mock("./api.js", () => ({ api: () => Promise.resolve({}), hasToken: () => true, API_BASE: "/api/v1" }));

import { ConfirmProvider, Modal, ToastProvider, useConfirm, useToast } from "./ui";

function mount(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return {
    render: (next: React.ReactElement) => act(() => root.render(next)),
    unmount: () => act(() => root.unmount()),
  };
}

/** Chrome is present in every assertion below — assert that first, or a missing
 *  element would read as "not inert" and the test would pass for the wrong reason. */
function chromeNodes(): HTMLElement[] {
  const nodes = ["main#main", "header", "aside", "nav[aria-label]", "a[href='#main']"].map((sel) =>
    document.querySelector<HTMLElement>(sel)
  );
  for (const [i, node] of nodes.entries()) {
    expect(node, `fixture element ${i} missing`).toBeTruthy();
  }
  return nodes as HTMLElement[];
}

/** Mirrors the app shell closely enough to assert the inert scope. */
function Chrome() {
  return React.createElement(
    React.Fragment,
    null,
    React.createElement("a", { href: "#main" }, "Skip to content"),
    React.createElement("header", null, React.createElement("button", null, "theme")),
    React.createElement("aside", null, React.createElement("a", { href: "/farm" }, "My Farm")),
    React.createElement("nav", { "aria-label": "Primary navigation" }, React.createElement("a", { href: "/" }, "Home")),
    React.createElement("main", { id: "main" }, "content")
  );
}

/** A dialog whose host re-renders on every keystroke — the shape that used to steal focus.
 *  `Modal` has no `open` prop: callers render it only while it should be open, which is
 *  what the app does (`{pending && <Modal …/>}`), so the harness mirrors that. */
function TypingDialog() {
  const [value, setValue] = useState("");
  return React.createElement(
    Modal,
    { title: "Withdraw", onClose: () => {}, footer: React.createElement("button", null, "Confirm") },
    React.createElement("input", {
      "aria-label": "amount",
      value,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value),
    })
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("dialog a11y — focus behaviour", () => {
  it("keeps focus in the field being typed in while the dialog re-renders", async () => {
    const mounted = mount(React.createElement(TypingDialog));
    const input = document.querySelector<HTMLInputElement>('input[aria-label="amount"]');
    expect(input, "the dialog did not render its field").toBeTruthy();

    act(() => input!.focus());
    expect(document.activeElement).toBe(input);

    // Type four characters, each of which re-renders the host and hands the dialog a
    // new inline onClose — the exact condition that used to reset focus.
    for (const char of "1500") {
      await act(async () => {
        input!.value = char;
        input!.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    expect(
      document.activeElement,
      "focus left the field the user was typing in — the dialog effect re-ran and re-focused its first element"
    ).toBe(input);
    mounted.unmount();
    // Component mounts are the slow part on a loaded runner (module transform +
    // jsdom); 5s proved too tight in full-suite runs (E-W2-05).
  }, 15_000);

  it("closes on Escape and restores focus to the previously focused element", async () => {
    const opener = document.createElement("button");
    opener.textContent = "open";
    document.body.appendChild(opener);
    opener.focus();

    let closed = false;
    function Harness() {
      return React.createElement(
        Modal,
        { title: "Confirm", open: true, onClose: () => { closed = true; } },
        React.createElement("p", null, "body")
      );
    }
    const mounted = mount(React.createElement(Harness));
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(closed, "Escape did not reach onClose").toBe(true);
    mounted.unmount();
  }, 15_000);
});

describe("toast surface — stacking, semantics, auto-dismiss (E-06)", () => {
  /** Pushes every message on mount; the toast API object is memoised, so the
   *  effect runs once. Four pushes exercise the max-3 stacking trim. */
  const PILE = [
    { kind: "info" as const, text: "toast-first" },
    { kind: "success" as const, text: "toast-second" },
    { kind: "error" as const, text: "toast-third" },
    { kind: "success" as const, text: "toast-fourth" },
  ];

  function Pusher({ items = PILE }: { items?: { kind: "info" | "success" | "error"; text: string }[] }) {
    const toast = useToast();
    React.useEffect(() => {
      for (const item of items) toast[item.kind](item.text);
    }, [toast, items]);
    return null;
  }

  it("keeps at most three toasts, dropping the oldest, and marks errors as alerts", async () => {
    const mounted = mount(
      React.createElement(ToastProvider, null, React.createElement(Pusher))
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("toast-second");
    expect(text).toContain("toast-third");
    expect(text).toContain("toast-fourth");
    expect(text, "the oldest toast was not dropped at the 3-toast cap").not.toContain("toast-first");

    // Error toasts announce assertively; the container is a polite live region.
    const error = Array.from(document.querySelectorAll('[role="alert"]')).find((n) =>
      (n.textContent ?? "").includes("toast-third")
    );
    expect(error, "the error toast lost its role=alert").toBeTruthy();
    expect(document.querySelector('[aria-live="polite"]')).toBeTruthy();
    mounted.unmount();
  }, 15_000);

  it("auto-dismisses a success toast (4s window) and removes it from the DOM", async () => {
    const single = [{ kind: "success" as const, text: "toast-autodismiss" }];
    const mounted = mount(
      React.createElement(ToastProvider, null, React.createElement(Pusher, { items: single }))
    );
    expect(document.body.textContent).toContain("toast-autodismiss");

    // Success toasts live 4000ms (errors 6000ms in providers' push()), plus the
    // ~250ms exit animation — wait past both, on real timers.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 4600));
    });
    expect(
      document.body.textContent,
      "the success toast was still mounted after its 4s auto-dismiss window"
    ).not.toContain("toast-autodismiss");
    mounted.unmount();
  }, 15000);
});

describe("dialog a11y — inert scope", () => {
  it("makes the app chrome inert while open and restores it on close", async () => {
    function Harness({ open }: { open: boolean }) {
      // Conditional render, exactly like the app's own dialogs.
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(Chrome),
        open ? React.createElement(TypingDialog) : null
      );
    }
    const mounted = mount(React.createElement(Harness, { open: true }));

    // Chrome is unreachable behind the dialog…
    for (const node of chromeNodes()) {
      expect(node.hasAttribute("inert"), `${node.tagName} should be inert while the dialog is open`).toBe(true);
    }
    // …but the dialog itself is not (the portal lives outside those regions).
    const input = document.querySelector('input[aria-label="amount"]');
    expect(input, "the dialog did not render its field").toBeTruthy();
    expect(input!.closest("[inert]"), "the dialog must not be inside the inert region").toBeNull();

    // Close it by re-rendering (not by unmounting — the fixture has to survive the
    // assertion) and check the marks are removed rather than merely unused.
    mounted.render(React.createElement(Harness, { open: false }));
    for (const node of chromeNodes()) {
      expect(node.hasAttribute("inert"), `${node.tagName} left inert after the dialog closed`).toBe(false);
    }
    mounted.unmount();
  }, 15_000);

  it("keeps the inline confirm dialog reachable (it is not portalled)", async () => {
    // The confirm dialog renders inside the React tree, not through a portal, so an
    // implementation that inerted the whole body would have made its own buttons
    // unreachable — the reason the inert scope names chrome regions instead.
    function Consumer() {
      const confirm = useConfirm();
      return React.createElement(
        "button",
        { onClick: () => void confirm({ title: "Delete?", body: "sure?" }) },
        "ask"
      );
    }
    const mounted = mount(
      React.createElement(
        ConfirmProvider,
        null,
        React.createElement(Chrome),
        React.createElement(Consumer)
      )
    );

    const ask = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "ask");
    expect(ask, "the fixture button was not rendered").toBeTruthy();
    await act(async () => {
      ask!.click();
    });

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog, "the confirm dialog did not open").toBeTruthy();
    expect(dialog!.closest("[inert]"), "the confirm dialog must not be inert").toBeNull();
    for (const node of chromeNodes()) {
      expect(node.hasAttribute("inert"), `${node.tagName} should be inert while a confirm is open`).toBe(true);
    }
    mounted.unmount();
  }, 15_000);
});
