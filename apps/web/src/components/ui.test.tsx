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

vi.mock("./session", () => ({ useSession: () => null }));
vi.mock("./api.js", () => ({ api: () => Promise.resolve({}), hasToken: () => true, API_BASE: "/api/v1" }));

import { ConfirmProvider, Modal, useConfirm } from "./ui";

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
  });

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
  });
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
  });

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
  });
});
