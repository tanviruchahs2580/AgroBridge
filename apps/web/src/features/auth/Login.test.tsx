/**
 * Component test for the login form's validation path (E-06) and for the two
 * later decisions that changed this screen: the owner's approved mock
 * composition (2026-11-12) and the install affordance that renders only while
 * the browser holds a real `beforeinstallprompt` (lib/installPrompt.ts).
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
 *   - the TOTP second step (SEC-04): a 401 TOTP_REQUIRED reveals the
 *     authenticator-code field, the retry carries `totp`, and both TOTP codes
 *     surface through errors-ui's dedicated bilingual copy
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
// The real module behind the api stub, so `ApiError` is the SAME class the
// unmocked errors-ui.ts imports — mapError's `err instanceof ApiError` (and the
// TOTP code map this suite pins) dies on a hand-rolled stand-in.
vi.mock("../../lib/api.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api.js")>("../../lib/api.js");
  return { ...actual, api: (...args: unknown[]) => mockApi(...args), setTokens: () => {} };
});
vi.mock("../../lib/analytics.js", () => ({ track: () => {} }));

import Login from "./Login";
import { ApiError } from "../../lib/api";
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
  localStorage.clear();
  mockApi.mockClear();
});
afterEach(() => {
  document.body.innerHTML = "";
});

/**
 * The owner's approved login mock (2026-11-12) reverses two earlier calls: the
 * h1 is the welcome and the sub-line names the task, and the three value bullets
 * sit below the way to Register. These assertions lock the mock's copy through
 * the dictionary (never a literal in the test), so a future refactor cannot
 * quietly drop a line the owner approved.
 */
describe("Login — the owner's approved mock composition", () => {
  it("renders the welcome heading, the sub-line and the three feature bullets", () => {
    const mounted = mount(React.createElement(MemoryRouter, null, React.createElement(Login)));

    expect(must<HTMLHeadingElement>("h1").textContent).toBe(dict.authWelcome.bn);
    const body = document.body.textContent ?? "";
    expect(body).toContain(dict.authLoginSub.bn);
    expect(body).toContain(dict.authFeaturesHeading.bn);
    for (const key of ["authFeatureDiseasePhoto", "authFeatureDirectMarket", "authFeatureServices"] as const) {
      expect(body, `${key} bullet must render`).toContain(dict[key].bn);
    }
    // The two ways off the screen are still there.
    expect(body).toContain(dict.authNoAccountPrefix.bn);
    expect(body).toContain(dict.forgotPasswordLink.bn);

    mounted.unmount();
  });

  it("offers the install affordance only while Chrome holds a prompt", async () => {
    const mounted = mount(React.createElement(MemoryRouter, null, React.createElement(Login)));

    const findInstall = () =>
      Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes(dict.installApp.bn));

    // No event yet: nothing is rendered — a button that cannot install would be
    // a claim the browser has not made.
    expect(findInstall()).toBeUndefined();

    const prompt = vi.fn(async () => {});
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
    });
    await act(async () => {
      window.dispatchEvent(event);
    });

    const install = findInstall();
    expect(install, "the control appears once the browser offers a prompt").toBeTruthy();
    expect(install?.textContent).toContain(dict.installApp.bn);

    await act(async () => {
      install?.click();
    });
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(findInstall()).toBeUndefined();

    mounted.unmount();
  });
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

/**
 * The TOTP second step (SEC-04): the field does not exist until the API answers
 * the first, password-only attempt with 401 TOTP_REQUIRED; the retry then carries
 * `totp`, and both TOTP codes reach the user through errors-ui's code map — the
 * server's English message must never paint a Bengali screen.
 */
describe("Login — TOTP second step (SEC-04)", () => {
  const TOTP_REQUIRED = dict.errTotpRequired.bn;
  const TOTP_INVALID = dict.errTotpInvalid.bn;

  async function flush() {
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
    }
  }

  /** Fill valid credentials and submit once, with the API answering 401 TOTP_REQUIRED. */
  async function firstAttemptAnsweredTotpRequired() {
    mockApi.mockRejectedValueOnce(new ApiError(401, "TOTP_REQUIRED", "Enter the 6-digit code from your authenticator app"));
    await type(must<HTMLInputElement>("#phone"), "01712345678");
    await type(must<HTMLInputElement>("#password"), "short");
    await act(async () => {
      must<HTMLButtonElement>('button[type="submit"]').click();
    });
    await flush();
  }

  it("a 401 TOTP_REQUIRED reveals the authenticator-code field with dedicated copy", async () => {
    const mounted = mount(React.createElement(MemoryRouter, null, React.createElement(Login)));
    await firstAttemptAnsweredTotpRequired();

    // The first call went out password-only — the server asked for the factor.
    expect(mockApi).toHaveBeenCalledWith("POST", "/auth/login", { phone: "01712345678", password: "short" });

    const totp = must<HTMLInputElement>("#totp");
    expect(totp.getAttribute("inputmode")).toBe("numeric");
    expect(totp.getAttribute("autocomplete")).toBe("one-time-code");
    expect(totp.getAttribute("maxlength")).toBe("6");
    // The banner names the second step in the user's language (code-mapped copy,
    // not the server's English sentence).
    expect(document.body.textContent).toContain(TOTP_REQUIRED);
    mounted.unmount();
  }, 15_000);

  it("the retry carries totp, and a wrong code surfaces the dedicated copy", async () => {
    const mounted = mount(React.createElement(MemoryRouter, null, React.createElement(Login)));
    await firstAttemptAnsweredTotpRequired();

    await type(must<HTMLInputElement>("#totp"), "123456");
    mockApi.mockRejectedValueOnce(new ApiError(401, "TOTP_INVALID", "That code is not valid — check your authenticator and try again"));
    await act(async () => {
      must<HTMLButtonElement>('button[type="submit"]').click();
    });
    await flush();

    expect(mockApi).toHaveBeenLastCalledWith("POST", "/auth/login", {
      phone: "01712345678",
      password: "short",
      totp: "123456",
    });
    expect(document.body.textContent).toContain(TOTP_INVALID);
    // The field stays for the corrected code.
    expect(must<HTMLInputElement>("#totp")).toBeTruthy();
    mounted.unmount();
  }, 15_000);

  it("a partial or non-numeric code is refused client-side before any retry", async () => {
    const mounted = mount(React.createElement(MemoryRouter, null, React.createElement(Login)));
    await firstAttemptAnsweredTotpRequired();

    // Digits-only onChange: letters never reach the value at all.
    await type(must<HTMLInputElement>("#totp"), "12ab");
    expect(must<HTMLInputElement>("#totp").value).toBe("12");

    await act(async () => {
      must<HTMLButtonElement>('button[type="submit"]').click();
    });
    await flush();

    // Still exactly the first attempt — no request went out with a bad code.
    expect(mockApi).toHaveBeenCalledTimes(1);
    expect(alerts()).toContain(dict.errOtpFormat.bn);
    mounted.unmount();
  }, 15_000);
});
