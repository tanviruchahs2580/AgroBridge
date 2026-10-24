/**
 * Feature test for the sell-crop form's validation path (AUD-V3 F1). Mounts
 * the real SellCrop screen with canned resources and drives the field
 * validations the farmer hits before any offer is filed: required farm/crop,
 * quantity bounds mirrored from the server zod schema (1..1,000,000 kg,
 * AUD-V3 L-3), and the moisture-parse guard that used to let `NaN` through
 * as null. Rejection paths never touch the API.
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

import SellCrop from "./SellCrop";
import { dict } from "../../lib/i18n";

function mount(node: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return { unmount: () => act(() => root.unmount()) };
}

/** One farm so the farm select can be populated; empty offers list. */
vi.mock("../../lib/useResource.js", () => ({
  useResource: (key: string) =>
    key === "farms"
      ? { data: [{ id: "farm1", name: "টেস্ট ফার্ম", district: "রংপুর" }], loading: false, error: null }
      : { data: [], loading: false, error: null },
  invalidate: () => {},
}));

function typeInto(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const form = () => document.querySelector<HTMLFormElement>("form")!;
const q = (sel: string) => document.querySelector<HTMLInputElement | HTMLSelectElement>(sel);

beforeEach(() => {
  mockApi.mockReset();
  mockApi.mockResolvedValue({});
  document.body.innerHTML = "";
});

describe("features/sell-crop — offer form validation", () => {
  it("requires farm, crop and quantity before anything is sent", async () => {
    mount(<SellCrop />);
    await act(async () => {
      form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(document.body.textContent).toContain(dict.errFieldRequired.bn);
    expect(mockApi).not.toHaveBeenCalled();
  });

  it("rejects an out-of-bounds quantity with the localized message (1..1,000,000 kg)", async () => {
    mount(<SellCrop />);
    const farm = q("#of-farm") ?? q("select");
    if (farm) typeInto(farm, "farm1");
    const crop = q("#of-crop");
    if (crop) typeInto(crop, "ধান");
    const qty = q("#of-qty");
    expect(qty).toBeTruthy();
    typeInto(qty!, "2000000"); // above the server's max(1_000_000)

    await act(async () => {
      form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(document.body.textContent).toContain(dict.errQuantityInvalid.bn);
    expect(mockApi).not.toHaveBeenCalled();
  });

  it("rejects unparsable moisture instead of sending NaN-as-null", async () => {
    mount(<SellCrop />);
    const farm = q("#of-farm") ?? q("select");
    if (farm) typeInto(farm, "farm1");
    const crop = q("#of-crop");
    if (crop) typeInto(crop, "ধান");
    typeInto(q("#of-qty")!, "100");
    const moisture = q("#of-moisture");
    expect(moisture).toBeTruthy();
    // A literal non-numeric string cannot reach a type=number input (the
    // browser empties it — which is WHY the NaN bug needed programmatic
    // input). 99 is typeable and outside the server's 0..60 range: the same
    // guard, driven the way a user actually can.
    typeInto(moisture!, "99");

    await act(async () => {
      form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(document.body.textContent).toContain(dict.errValidation.bn);
    expect(mockApi).not.toHaveBeenCalled();
  });
});
