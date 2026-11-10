/**
 * Account & settings screen (F-29 — 113 lines, 0% coverage before this file).
 *
 * What is pinned here is what the screen is for: the profile form is prefilled
 * from `GET /auth/me` before the first paint of the fields, and a save sends only
 * what the API accepts (trimmed, empty optionals omitted) — the failure modes
 * being a blank form on a slow read and a payload that would clear a field the
 * user never touched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

const calls: { method: string; path: string; body?: unknown }[] = [];

const me = {
  id: "u-1",
  fullName: "করিম মিয়া",
  phone: "01712345678",
  email: null,
  role: "FARMER",
  langPref: "bn",
  status: "ACTIVE",
  phoneVerified: false,
  region: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  farmerProfile: {
    membershipTier: "FREE",
    membershipExpiresAt: null,
    district: "রংপুর",
    upazila: null,
    address: null,
    joinedAt: "2026-01-01T00:00:00.000Z",
  },
  wallet: null,
};

const mockApi = vi.fn((...args: unknown[]) => {
  const method = args[0] as string;
  const path = args[1] as string;
  calls.push({ method, path, body: args[2] });
  if (method === "GET" && path === "/auth/me") return Promise.resolve(me);
  if (method === "PATCH" && path === "/auth/me") return Promise.resolve({});
  return Promise.resolve({});
});

vi.mock("../../lib/session", () => ({
  useSession: () => ({
    session: { lang: "bn", fullName: "করিম মিয়া", role: "FARMER" },
    setLang: async () => {},
    endSession: () => {},
    loading: false,
    dark: false,
    refresh: async () => {},
    logout: () => {},
    toggleDark: () => {},
  }),
}));
vi.mock("../../lib/api.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api.js")>("../../lib/api.js");
  return { ...actual, api: (...args: unknown[]) => mockApi(...args) };
});
vi.mock("../../lib/analytics.js", () => ({ track: () => {} }));

import Settings from "./Settings";
import { dict } from "../../lib/i18n";

/**
 * Roots mounted by the current test. Tracked so a failing assertion still tears
 * the tree down: a leaked mount keeps its useResource subscription alive, and the
 * next test in the file then sees an invalidate refetch from the previous test's
 * component (observed as an extra GET in the request log).
 */
const mountedRoots: { unmount: () => void }[] = [];

function mount(node: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  let alive = true;
  const unmount = () => {
    if (!alive) return;
    alive = false;
    act(() => root.unmount());
    container.remove();
  };
  mountedRoots.push({ unmount });
  return { unmount };
}

async function flush(times = 2) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const NATIVE_VALUE_SETTER = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    if (NATIVE_VALUE_SETTER) NATIVE_VALUE_SETTER.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function input(id: string): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>(`#${id}`);
  if (!el) throw new Error(`no input #${id}`);
  return el;
}

beforeEach(() => {
  calls.length = 0;
  document.body.innerHTML = "";
  mockApi.mockClear();
});

afterEach(() => {
  while (mountedRoots.length) mountedRoots.pop()!.unmount();
  document.body.innerHTML = "";
});

describe("features/settings — profile form (F-29)", () => {
  it("prefills the fields from GET /auth/me", async () => {
    const { unmount } = mount(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    );
    await flush();

    expect(input("st-name").value).toBe("করিম মিয়া");
    expect(input("st-district").value).toBe("রংপুর");
    expect(input("st-email").value).toBe("");
    // The unverified state carries the phone-verification path, which is the
    // only route to a withdrawal.
    expect(document.body.textContent).toContain(dict.notVerifiedLabel.bn);
    unmount();
  });

  it("saves trimmed values and omits empty optionals", async () => {
    const { unmount } = mount(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    );
    await flush();

    await type(input("st-name"), "  করিম  ");
    await type(input("st-upazila"), "বদরগঞ্জ");
    const submit = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes(dict.save.bn));
    expect(submit).toBeTruthy();
    await act(async () => {
      submit!.click();
    });
    await flush();

    const patch = calls.find((c) => c.method === "PATCH" && c.path === "/auth/me");
    expect(patch).toBeTruthy();
    // Trimmed, and the untouched-but-empty email/address stay out of the payload
    // so "empty" cannot be read as "clear this field".
    expect(patch!.body).toEqual({ fullName: "করিম", district: "রংপুর", upazila: "বদরগঞ্জ" });
    unmount();
  });

  it("refuses an invalid email without touching the API", async () => {
    const { unmount } = mount(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    );
    await flush();

    await type(input("st-email"), "not-an-email");
    const submit = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes(dict.save.bn));
    await act(async () => {
      submit!.click();
    });
    await flush();

    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    expect(Array.from(document.querySelectorAll('p[role="alert"]')).map((p) => p.textContent)).toContain(dict.errEmailInvalid.bn);
    unmount();
  });
});
