/**
 * Component test for the login form's validation path (E-06).
 *
 * The audit asks that validation errors reach the user as visible, localized
 * copy — not just state. This mounts the real Login form (no testing-library in
 * this repo; raw react-dom/client + act, mirroring components/ui.test.tsx) and
 * drives the two validation branches that exist:
 *   - empty submit → both required-field messages render as role="alert"
 *   - invalid phone + blur → the BD-phone message replaces the field state
 *   - a SHORT password is deliberately not a client-side error here (F-35):
 *     the registration length policy does not apply to authentication, and the
 *     submit is allowed to reach the API with it
 * No network is touched: the component's own validation returns before api().
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

const mockApi = vi.fn(() => Promise.resolve({}));

// Keep the test on the form's own logic: no session provider, no API, no analytics.
vi.mock("../../lib/session", () => ({
  useSession: () => ({ session: { lang: "bn", fullName: "Test", role: "FARMER" }, refresh: async () => {} }),
}));
vi.mock("../../lib/api.js", () => ({
  api: (...args: unknown[]) => mockApi(...args),
  setTokens: () => {},
  hasToken: () => false,
  API_BASE: "/api/v1",
}));
vi.mock("../../lib/analytics.js", () => ({ track: () => {} }));

import Login from "./Login";
import { dict } from "../../lib/i18n";

// The expected copy comes from the dictionary itself (single source of truth
// for the assertions — the same keys the component renders).
const REQUIRED = dict.errFieldRequired.bn;
const PHONE_INVALID = dict.errPhoneInvalid.bn;
const WEAK_PASSWORD = dict.errWeakPassword.bn;

function mount(node: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return { unmount: () => act(() => root.unmount()) };
}

function must<T extends Element>(sel: string): T {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`fixture element not found: ${sel}`);
  return el;
}

/**
 * Type into a controlled input the way a browser does. React installs its own
 * `value` accessor on the node to track changes, so assigning `el.value`
 * directly makes React see "no change" and skip onChange — use the native
 * prototype setter (what user-event does under the hood) and dispatch `input`.
 */
const NATIVE_VALUE_SETTER = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    if (NATIVE_VALUE_SETTER) NATIVE_VALUE_SETTER.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function blur(el: HTMLInputElement) {
  await act(async () => {
    // React maps onBlur to the native `focusout` event (which bubbles), not `blur`.
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

function alerts(): string[] {
  return Array.from(document.querySelectorAll('p[role="alert"]')).map((n) => n.textContent ?? "");
}

beforeEach(() => {
  document.body.innerHTML = "";
  mockApi.mockClear();
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("Login form — validation reaches the user", () => {
  it("empty submit renders both required messages and calls no API", async () => {
    const mounted = mount(
      React.createElement(MemoryRouter, null, React.createElement(Login))
    );
    const submit = must<HTMLButtonElement>('button[type="submit"]');
    await act(async () => {
      submit.click();
    });

    const shown = alerts();
    expect(shown.filter((s) => s === REQUIRED)).toHaveLength(2);
    expect(must<HTMLInputElement>("#phone").getAttribute("aria-invalid")).toBe("true");
    expect(must<HTMLInputElement>("#password").getAttribute("aria-invalid")).toBe("true");
    expect(mockApi).not.toHaveBeenCalled();
    mounted.unmount();
  }, 15_000);

  it("does not apply the registration password policy to sign-in (F-35)", async () => {
    const mounted = mount(
      React.createElement(MemoryRouter, null, React.createElement(Login))
    );
    const phone = must<HTMLInputElement>("#phone");
    const password = must<HTMLInputElement>("#password");

    await type(phone, "12345");
    await blur(phone);
    expect(alerts()).toContain(PHONE_INVALID);

    // A short password is the SERVER's business: `POST /auth/login` accepts
    // `z.string().min(1)`, and this form used to reject anything under 8 with the
    // signing-UP policy — so a mistyped password was reported as "weak" instead
    // of "wrong", the button was dead until blur, and a legacy account with a
    // short password could never sign in from the web client at all.
    await type(password, "short");
    await blur(password);
    expect(alerts()).not.toContain(WEAK_PASSWORD);
    expect(must<HTMLInputElement>("#password").getAttribute("aria-invalid")).not.toBe("true");

    // The phone number is now valid, so the submit control is live and the short
    // password reaches the API — where the credential check decides.
    await type(phone, "01712345678");
    const submit = must<HTMLButtonElement>('button[type="submit"]');
    expect(submit.disabled).toBe(false);
    await act(async () => {
      submit.click();
    });
    expect(mockApi).toHaveBeenCalledTimes(1);
    expect(mockApi).toHaveBeenCalledWith("POST", "/auth/login", { phone: "01712345678", password: "short" });
    mounted.unmount();
  }, 15_000);
});
