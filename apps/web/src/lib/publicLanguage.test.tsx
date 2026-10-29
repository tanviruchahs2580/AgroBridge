import { act } from "react";
import React from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Legal from "../features/legal/Legal";
import { PUBLIC_LANG_KEY } from "./publicLanguage";

/**
 * Live-audit regression (2026-10-29): the public legal documents rendered in Bengali
 * for every visitor, whatever they had chosen.
 *
 * Read from the deployed site: switch to English on the login page (the choice is
 * stored under `agrobridge.auth_lang` and the toggle confirms it), then open
 * `/privacy` — Bengali, with no language control on the page at all. A Google Play
 * reviewer reading the policy is the same visitor. The not-found page had the same
 * shape, and each public surface decided the language for itself.
 *
 * These tests pin the shared rule: a public screen follows the visitor's stored
 * choice, offers a control when none is stored, and never touches the account.
 */
function render(node: React.ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<MemoryRouter>{node}</MemoryRouter>);
  });
  return { host, root };
}

const h1 = (host: HTMLElement) => host.querySelector("h1")?.textContent ?? "";

describe("public language on the legal documents", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = "";
  });

  afterEach(() => {
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("defaults to Bengali for a first-time visitor", () => {
    const { host, root } = render(<Legal docId="privacy" />);
    expect(h1(host)).toBe("গোপনীয়তা নীতি");
    act(() => root.unmount());
  });

  it("honours the language the visitor already chose on another public screen", () => {
    localStorage.setItem(PUBLIC_LANG_KEY, "en");
    const { host, root } = render(<Legal docId="privacy" />);
    expect(h1(host), "the English choice made on the login page must carry into the policy").toBe("Privacy Policy");
    act(() => root.unmount());
  });

  it("offers a control on the page, and switching it persists for the next screen", async () => {
    const { host, root } = render(<Legal docId="terms" />);
    const toggle = host.querySelector("button");
    expect(toggle, "the legal page must offer a way to change the language").not.toBeNull();

    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(h1(host)).toBe("Terms of Service");
    expect(localStorage.getItem(PUBLIC_LANG_KEY)).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    act(() => root.unmount());
  });

  it("switches back, so the control is not a one-way door", async () => {
    localStorage.setItem(PUBLIC_LANG_KEY, "en");
    const { host, root } = render(<Legal docId="privacy" />);
    await act(async () => {
      host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(h1(host)).toBe("গোপনীয়তা নীতি");
    expect(localStorage.getItem(PUBLIC_LANG_KEY)).toBe("bn");
    act(() => root.unmount());
  });
});
