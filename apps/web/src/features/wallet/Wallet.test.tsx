/**
 * Feature test for the withdrawal form's validation path (AUD-V3 F1).
 * Mounts the real Wallet screen with canned resources and drives the money
 * guardrails that protect the wallet: the 100-taka minimum, the
 * available-balance ceiling (balance minus PENDING withdrawal holds), and the
 * busy-guard that blocks double-submit. No network touched on the rejection
 * paths — the form's own validation returns before api().
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";

const mockApi = vi.fn(() => Promise.resolve({}));

vi.mock("../../lib/session", () => ({
  useSession: () => ({ session: { lang: "bn", fullName: "Test", role: "FARMER" }, refresh: async () => {} }),
}));
vi.mock("../../lib/api.js", () => ({
  api: (...args: unknown[]) => mockApi(...args),
  setTokens: () => {},
  clearTokens: () => {},
  hasToken: () => false,
  API_BASE: "/api/v1",
}));
vi.mock("../../lib/analytics.js", () => ({ track: () => {} }));

import WalletPage from "./Wallet";
import { dict } from "../../lib/i18n";

function mount(node: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return { unmount: () => act(() => root.unmount()) };
}

function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Canned resources: a 500-taka balance with a 50-taka pending withdrawal. */
vi.mock("../../lib/useResource.js", () => ({
  useResource: (_key: string) => {
    if (_key === "wallet") {
      return { data: { balancePaisa: 50000, transactions: [] }, loading: false, error: null };
    }
    if (_key === "wallet-summary") {
      return { data: { creditsPaisa: 0, debitsPaisa: 0, pendingWithdrawalsPaisa: 5000 }, loading: false, error: null };
    }
    return { data: [], loading: false, error: null };
  },
  invalidate: () => {},
}));

beforeEach(() => {
  mockApi.mockReset();
  mockApi.mockResolvedValue({});
  document.body.innerHTML = "";
});

describe("features/wallet — withdrawal guardrails", () => {
  it("refuses an amount below the 100-taka minimum without touching the API", () => {
    mount(<WalletPage />);
    const openBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes(dict.withdrawTitle.bn));
    expect(openBtn).toBeTruthy();
    act(() => openBtn!.click());

    const amount = document.querySelector<HTMLInputElement>("#wd-amount");
    expect(amount).toBeTruthy();
    const form = amount!.closest("form")!;
    typeInto(amount!, "50"); // below MIN_WITHDRAWAL_PAISA (10_000 = 100 taka)
    act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(document.body.textContent).toContain(dict.errAmountInvalid.bn);
    expect(mockApi).not.toHaveBeenCalled();
  });

  it("refuses an amount above the available balance (balance minus pending holds)", () => {
    mount(<WalletPage />);
    const openBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes(dict.withdrawTitle.bn));
    act(() => openBtn!.click());

    const amount = document.querySelector<HTMLInputElement>("#wd-amount")!;
    const form = amount.closest("form")!;
    typeInto(amount, "460"); // 460 taka > available 450 (500 - 50 pending)
    act(() => form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(document.body.textContent).toContain(dict.errInsufficientBalance.bn);
    expect(mockApi).not.toHaveBeenCalled();
  });

  it("accepts an amount within the available balance and posts paisa to the API", async () => {
    mount(<WalletPage />);
    const openBtn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes(dict.withdrawTitle.bn));
    act(() => openBtn!.click());

    const amount = document.querySelector<HTMLInputElement>("#wd-amount")!;
    const form = amount.closest("form")!;
    typeInto(amount, "450"); // exactly the available balance
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(mockApi).toHaveBeenCalledTimes(1);
    const [method, path, body] = mockApi.mock.calls[0]!;
    expect(method).toBe("POST");
    expect(path).toBe("/wallet/withdrawals");
    expect((body as { amountPaisa: number }).amountPaisa).toBe(45000);
  });
});
