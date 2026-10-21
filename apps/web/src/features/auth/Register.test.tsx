/**
 * Component test for the consent checkbox (PRD-05/AUD-150).
 *
 * Registering now requires accepting the Terms + Privacy Policy: the API
 * refuses a body without `consent: true`, so the form must (a) block submit
 * while the box is unchecked and (b) send `consent: true` when it is. Mounted
 * the same way as Login.test.tsx (raw react-dom/client + act), with the
 * transport mocked so no network is touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

const { mockApi, mockSetTokens } = vi.hoisted(() => ({ mockApi: vi.fn(() => Promise.resolve({ accessToken: "a", refreshToken: "r" })), mockSetTokens: vi.fn() }));

vi.mock("../../lib/session", () => ({
  useSession: () => ({ session: { lang: "bn", fullName: "Test", role: "FARMER" }, refresh: async () => {} }),
}));
vi.mock("../../lib/api.js", () => ({
  api: (...args: unknown[]) => mockApi(...args),
  setTokens: (...args: unknown[]) => mockSetTokens(...args),
  hasToken: () => false,
  API_BASE: "/api/v1",
}));
vi.mock("../../lib/analytics.js", () => ({ track: () => {} }));

import Register from "./Register";
import { dict } from "../../lib/i18n";

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

const NATIVE_VALUE_SETTER = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    if (NATIVE_VALUE_SETTER) NATIVE_VALUE_SETTER.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function fillValidForm() {
  await type(must<HTMLInputElement>("#name"), "Test Farmer");
  await type(must<HTMLInputElement>("#rphone"), "01712345678");
  await type(must<HTMLInputElement>("#rpass"), "Test@1234");
}

beforeEach(() => {
  document.body.innerHTML = "";
  mockApi.mockClear();
  mockSetTokens.mockClear();
});
afterEach(() => {
  document.body.innerHTML = "";
});

describe("Register — consent capture (PRD-05/AUD-150)", () => {
  it("blocks submit while the consent checkbox is unchecked and sends no request", async () => {
    const mounted = mount(React.createElement(MemoryRouter, null, React.createElement(Register)));
    await fillValidForm();

    const submit = must<HTMLButtonElement>('button[type="submit"]');
    expect(must<HTMLInputElement>("#consent").checked).toBe(false);
    expect(submit.disabled).toBe(true);
    // The reason is visible, not just a dead button.
    expect(document.body.textContent).toContain(dict.errConsentRequired.bn);

    await act(async () => {
      submit.click();
    });
    expect(mockApi).not.toHaveBeenCalled();
    mounted.unmount();
  }, 15_000);

  it("sends consent:true once the box is checked", async () => {
    const mounted = mount(React.createElement(MemoryRouter, null, React.createElement(Register)));
    await fillValidForm();

    const checkbox = must<HTMLInputElement>("#consent");
    await act(async () => {
      checkbox.click();
    });
    expect(checkbox.checked).toBe(true);

    const submit = must<HTMLButtonElement>('button[type="submit"]');
    expect(submit.disabled).toBe(false);
    await act(async () => {
      submit.click();
    });

    expect(mockApi).toHaveBeenCalledTimes(1);
    expect(mockApi).toHaveBeenCalledWith("POST", "/auth/register", {
      fullName: "Test Farmer",
      phone: "01712345678",
      password: "Test@1234",
      langPref: "bn",
      consent: true,
    });
    mounted.unmount();
  }, 15_000);
});
