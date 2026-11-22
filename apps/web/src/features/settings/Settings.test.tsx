/**
 * Account & settings screen (F-29 — 113 lines, 0% coverage before this file).
 *
 * What is pinned here is what the screen is for: the profile form is prefilled
 * from `GET /auth/me` before the first paint of the fields, and a save sends only
 * what the API accepts (trimmed, empty optionals omitted) — the failure modes
 * being a blank form on a slow read and a payload that would clear a field the
 * user never touched. The SEC-04 suites pin the two later gates: account
 * deletion carries a fresh step-up `otp`, and the administrator TOTP panel
 * enrols, activates, reads a 409 re-enrol as "already enabled", and surfaces a
 * wrong authenticator code with the dedicated bilingual copy.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

const calls: { method: string; path: string; body?: unknown }[] = [];

/** The signed-in role the session mock reports — the TOTP panel reads it. */
let testRole = "FARMER";

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
  if (method === "POST" && path === "/auth/otp/stepup") {
    return Promise.resolve({ sent: true, expiresAt: "2026-01-01T00:10:00.000Z" });
  }
  if (method === "POST" && path === "/auth/totp/enroll") {
    return Promise.resolve({
      secret: "JBSWY3DPEHPK3PXP",
      otpauthUrl: "otpauth://totp/AgroBridge:01712345678?secret=JBSWY3DPEHPK3PXP&digits=6&period=30",
    });
  }
  return Promise.resolve({});
});

vi.mock("../../lib/session", () => ({
  useSession: () => ({
    session: { lang: "bn", fullName: "করিম মিয়া", role: testRole },
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
import { ApiError } from "../../lib/api";
import { ConfirmProvider } from "../../components/ui";
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
  testRole = "FARMER";
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

/**
 * The real confirm dialog is mounted for the deletion suites: useConfirm's
 * fallback resolves `false`, which would silently end every delete attempt
 * before the API call the suite is here to pin.
 */
function mountWithConfirm() {
  return mount(
    <MemoryRouter>
      <ConfirmProvider>
        <Settings />
      </ConfirmProvider>
    </MemoryRouter>
  );
}

function buttonWith(text: string): HTMLButtonElement {
  const btn = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes(text));
  if (!btn) throw new Error(`no button containing: ${text}`);
  return btn;
}

describe("features/settings — deletion step-up (SEC-04)", () => {
  it("refuses the confirm dialog until a six-digit code is present", async () => {
    const { unmount } = mountWithConfirm();
    await flush();

    await act(async () => {
      buttonWith(dict.deleteAccount.bn).click();
    });
    await flush();

    // The gate runs server-side before the money guards, so without the code
    // nothing can succeed: no confirm dialog, no DELETE.
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    expect(document.body.textContent).toContain(dict.errOtpFormat.bn);
    expect(document.body.textContent).not.toContain(dict.deleteAccountConfirm.bn);
    unmount();
  });

  it("sends the step-up code and carries it as otp on DELETE /auth/me", async () => {
    const { unmount } = mountWithConfirm();
    await flush();

    await act(async () => {
      buttonWith(dict.stepUpSendCode.bn).click();
    });
    await flush();

    expect(calls.some((c) => c.method === "POST" && c.path === "/auth/otp/stepup")).toBe(true);
    expect(document.body.textContent).toContain(dict.stepUpSent.bn);

    await type(input("st-del-otp"), "654321");
    await act(async () => {
      buttonWith(dict.deleteAccount.bn).click();
    });
    await flush();

    await act(async () => {
      buttonWith(dict.deleteAccountConfirm.bn).click();
    });
    await flush();

    const del = calls.find((c) => c.method === "DELETE" && c.path === "/auth/me");
    expect(del, "the confirmed deletion reached the API").toBeTruthy();
    expect(del!.body).toEqual({ otp: "654321" });
    unmount();
  });
});

describe("features/settings — admin two-step verification panel (SEC-04)", () => {
  it("renders only for administrator roles", async () => {
    const { unmount } = mount(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    );
    await flush();

    expect(document.body.textContent).not.toContain(dict.totpEnabledTitle.bn);
    unmount();
  });

  it("enrols, shows the secret and setup URL, then activates and disables with the code", async () => {
    testRole = "ADMIN";
    const { unmount } = mount(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    );
    await flush();
    expect(document.body.textContent).toContain(dict.totpEnabledTitle.bn);

    await act(async () => {
      buttonWith(dict.totpEnableBtn.bn).click();
    });
    await flush();

    expect(calls.some((c) => c.method === "POST" && c.path === "/auth/totp/enroll")).toBe(true);
    // The key and the otpauth URL are both on screen for the authenticator app.
    expect(document.body.textContent).toContain("JBSWY3DPEHPK3PXP");
    expect(document.body.textContent).toContain("otpauth://totp/AgroBridge:01712345678");
    expect(document.body.textContent).toContain(dict.totpSecretHint.bn);

    await type(input("st-totp"), "123456");
    await act(async () => {
      buttonWith(dict.verify.bn).click();
    });
    await flush();

    expect(calls.some((c) => c.method === "POST" && c.path === "/auth/totp/activate" && (c.body as { code?: string }).code === "123456")).toBe(true);
    expect(document.body.textContent).toContain(dict.totpEnabledBadge.bn);
    expect(document.body.textContent).toContain(dict.totpDisableBtn.bn);

    // Shedding the factor demands a code from it too.
    await type(input("st-totp"), "654321");
    await act(async () => {
      buttonWith(dict.totpDisableBtn.bn).click();
    });
    await flush();

    expect(calls.some((c) => c.method === "POST" && c.path === "/auth/totp/disable" && (c.body as { code?: string }).code === "654321")).toBe(true);
    expect(document.body.textContent).toContain(dict.totpEnableBtn.bn);
    unmount();
  });

  it("reads a 409 re-enrol as already-enabled and offers the disable flow", async () => {
    testRole = "ADMIN";
    const { unmount } = mount(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    );
    await flush();
    // Queued after the mount read so the rejection lands on the enrolment.
    mockApi.mockRejectedValueOnce(new ApiError(409, "CONFLICT", "TOTP is already enabled — disable it before re-enrolling"));

    await act(async () => {
      buttonWith(dict.totpEnableBtn.bn).click();
    });
    await flush();

    // No status read exists, so the 409 is the panel's only way to learn an
    // enrolment exists: the badge and the disable flow appear, and the
    // server's English message never paints the screen.
    expect(document.body.textContent).toContain(dict.totpEnabledBadge.bn);
    expect(input("st-totp")).toBeTruthy();
    expect(document.body.textContent).not.toContain("TOTP is already enabled");
    unmount();
  });

  it("surfaces a wrong activation code with the dedicated TOTP copy", async () => {
    testRole = "ADMIN";
    const { unmount } = mount(
      <MemoryRouter>
        <Settings />
      </MemoryRouter>
    );
    await flush();

    await act(async () => {
      buttonWith(dict.totpEnableBtn.bn).click();
    });
    await flush();
    await type(input("st-totp"), "000000");
    mockApi.mockRejectedValueOnce(new ApiError(400, "TOTP_INVALID", "That code is not valid — check your authenticator and try again"));
    await act(async () => {
      buttonWith(dict.verify.bn).click();
    });
    await flush();

    expect(document.body.textContent).toContain(dict.errTotpInvalid.bn);
    unmount();
  });
});
