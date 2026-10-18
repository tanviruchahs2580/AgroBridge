/**
 * Component test for the app-level ErrorBoundary (E-06).
 *
 * The boundary is the last line of defence against a blank screen: it must show
 * a localized fallback instead of the crashed subtree, and the fallback's retry
 * must reset the boundary so the next render can succeed. React logs the caught
 * render throw (and the boundary logs it for monitoring), so console.error is
 * silenced for the duration — the assertions are about the DOM the user sees.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("../lib/session", () => ({ useSession: () => null }));
vi.mock("../lib/api.js", () => ({ api: () => Promise.resolve({}), hasToken: () => false, API_BASE: "/api/v1" }));

import { ErrorBoundary } from "./ErrorBoundary";
import { dict } from "../lib/i18n";

const FALLBACK_BN = dict.errorGeneric.bn;
const RETRY_BN = dict.retry.bn;

function mount(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return { unmount: () => act(() => root.unmount()) };
}

let throwOnRender = true;
function Bomb() {
  if (throwOnRender) throw new Error("component exploded");
  return React.createElement("p", null, "recovered content");
}

function retryButton(): HTMLButtonElement {
  const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes(RETRY_BN));
  if (!btn) throw new Error("retry control missing from the fallback");
  return btn as HTMLButtonElement;
}

beforeEach(() => {
  throwOnRender = true;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("ErrorBoundary", () => {
  it("renders the localized fallback instead of the crashed subtree", () => {
    const mounted = mount(
      React.createElement(ErrorBoundary, { lang: "bn" }, React.createElement(Bomb))
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain(FALLBACK_BN);
    expect(text).toContain(RETRY_BN);
    expect(text, "the crashed child leaked through the boundary").not.toContain("recovered content");
    mounted.unmount();
  }, 15_000);

  it("uses the English fallback when lang is en", () => {
    const mounted = mount(
      React.createElement(ErrorBoundary, { lang: "en" }, React.createElement(Bomb))
    );
    expect(document.body.textContent).toContain(dict.errorGeneric.en);
    mounted.unmount();
  }, 15_000);

  it("retry resets the boundary and re-renders the children", async () => {
    const mounted = mount(
      React.createElement(ErrorBoundary, { lang: "bn" }, React.createElement(Bomb))
    );
    expect(document.body.textContent).toContain(FALLBACK_BN);

    // The next render of the child succeeds — exactly what a transient
    // render-time failure (e.g. a bad prop once) looks like.
    throwOnRender = false;
    await act(async () => {
      retryButton().click();
    });
    expect(document.body.textContent).toContain("recovered content");
    expect(document.body.textContent).not.toContain(FALLBACK_BN);
    mounted.unmount();
  }, 15_000);
});
