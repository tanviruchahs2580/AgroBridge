/**
 * Component test for the password-recovery screen (E-06 style, like
 * Login.test.tsx — raw react-dom/client + act, no testing-library).
 *
 * Pins the API contract the screen was built against, because the screen is
 * useless if the payload drifts:
 *   POST /auth/password/forgot  { phone }
 *   POST /auth/password/reset   { phone, otp, newPassword }
 * and that the OTP error codes reach the user as localized copy instead of the
 * server's English message. No network: api() is mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

const mockApi = vi.fn();

vi.mock("../../lib/session", () => ({
  useSession: () => ({ session: null }),
}));
vi.mock("../../lib/api.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api.js")>("../../lib/api.js");
  return { ...actual, api: (...args: unknown[]) => mockApi(...args) };
});

import Reset from "./Reset";
import { ApiError } from "../../lib/api";
import { dict } from "../../lib/i18n";

const PHONE = "01700000002";

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

/** React tracks its own `value` accessor — assign through the native setter. */
const NATIVE_VALUE_SETTER = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    if (NATIVE_VALUE_SETTER) NATIVE_VALUE_SETTER.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  await act(async () => {
    must<HTMLButtonElement>('button[type="submit"]').click();
  });
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

async function mountAtCodeStep(uiLangCopy = dict.resetCodeSent.bn) {
  const mounted = mount(React.createElement(MemoryRouter, null, React.createElement(Reset)));
  await type(must<HTMLInputElement>("#reset-phone"), PHONE);
  await submit();
  expect(bodyText()).toContain(uiLangCopy);
  return mounted;
}

beforeEach(() => {
  document.body.innerHTML = "";
  mockApi.mockReset();
  mockApi.mockResolvedValue({ ok: true });
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("Reset password — two-step recovery", () => {
  it("rejects an invalid phone locally, without calling the API", async () => {
    const mounted = mount(React.createElement(MemoryRouter, null, React.createElement(Reset)));
    await type(must<HTMLInputElement>("#reset-phone"), "12345");
    await submit();

    expect(bodyText()).toContain(dict.errPhoneInvalid.bn);
    expect(mockApi).not.toHaveBeenCalled();
    expect(must<HTMLInputElement>("#reset-phone").getAttribute("aria-invalid")).toBe("true");
    mounted.unmount();
  });

  it("sends { phone } to /auth/password/forgot and advances to the code step", async () => {
    const mounted = await mountAtCodeStep();
    expect(mockApi).toHaveBeenCalledTimes(1);
    expect(mockApi).toHaveBeenCalledWith("POST", "/auth/password/forgot", { phone: PHONE });
    // The code step is the one that carries the OTP field.
    expect(document.querySelector("#reset-otp")).toBeTruthy();
    mounted.unmount();
  });

  it("validates code format and password length before the reset call", async () => {
    const mounted = await mountAtCodeStep();
    await type(must<HTMLInputElement>("#reset-otp"), "12");
    await type(must<HTMLInputElement>("#reset-password"), "short");
    await submit();

    expect(bodyText()).toContain(dict.errOtpFormat.bn);
    expect(bodyText()).toContain(dict.errWeakPassword.bn);
    expect(mockApi).toHaveBeenCalledTimes(1); // only the forgot call so far
    mounted.unmount();
  });

  it("posts { phone, otp, newPassword } and ends on the success state", async () => {
    const mounted = await mountAtCodeStep();
    await type(must<HTMLInputElement>("#reset-otp"), "123456");
    await type(must<HTMLInputElement>("#reset-password"), "brand-new-pass");
    await submit();

    expect(mockApi).toHaveBeenLastCalledWith("POST", "/auth/password/reset", {
      phone: PHONE,
      otp: "123456",
      newPassword: "brand-new-pass",
    });
    expect(bodyText()).toContain(dict.resetSuccess.bn);
    mounted.unmount();
  });

  it("shows an OTP_INVALID answer as localized copy, not the server message", async () => {
    const mounted = await mountAtCodeStep();
    mockApi.mockRejectedValueOnce(new ApiError(400, "OTP_INVALID", "Invalid or expired code"));
    await type(must<HTMLInputElement>("#reset-otp"), "999999");
    await type(must<HTMLInputElement>("#reset-password"), "brand-new-pass");
    await submit();

    expect(bodyText()).toContain(dict.errOtpInvalid.bn);
    expect(bodyText()).not.toContain("Invalid or expired code");
    mounted.unmount();
  });
});
