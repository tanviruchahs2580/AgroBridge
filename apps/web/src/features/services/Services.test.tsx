/**
 * Services screen (F-29 — 95 lines, 0% coverage) plus the two behavioural fixes
 * on it:
 *
 *   - a booking invalidates the bookings list ONLY. The form's farm is an input
 *     to the dialog, not an output of it, and `POST /bookings` creates a Booking
 *     row and nothing else — the old code invalidated the whole `services`
 *     catalogue family, refetching and re-mounting every service card on the page
 *     the farmer was still reading (F: booking invalidates the catalogue);
 *   - the sort select's default option names the ordering instead of repeating
 *     the field's own label (F: selects using the field label as the empty
 *     option's text).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

const calls: { method: string; path: string; body?: unknown }[] = [];

const service = {
  id: "s1",
  code: "TRAC",
  name: "ট্রাক্টর ভাড়া",
  category: "TRACTOR",
  basePricePaisa: 150000,
  priceUnit: "PER_BIGHA",
  description: "মাটি চাষ",
  isActive: true,
  providers: [{ id: "pv1", name: "রহিম", district: "রংপুর", ratingSum: 9, ratingCount: 2 }],
};

const farm = {
  id: "f1",
  ownerId: "u1",
  organizationId: null,
  name: "উত্তর মাঠ",
  address: null,
  district: "রংপুর",
  upazila: null,
  lat: null,
  lng: null,
  totalAreaBigha: 2,
  status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  plots: [],
};

const mockApi = vi.fn((...args: unknown[]) => {
  const method = args[0] as string;
  const path = args[1] as string;
  calls.push({ method, path, body: args[2] });
  if (method === "GET" && path === "/services") return Promise.resolve([service]);
  if (method === "GET" && path === "/bookings") return Promise.resolve([]);
  if (method === "GET" && path === "/farms") return Promise.resolve([farm]);
  if (method === "POST" && path === "/bookings") return Promise.resolve({ id: "b1", bookingNo: "BKG-1" });
  return Promise.resolve({});
});

vi.mock("../../lib/session", () => ({
  useSession: () => ({ session: { lang: "bn", fullName: "Test", role: "FARMER" }, refresh: async () => {} }),
}));
vi.mock("../../lib/api.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api.js")>("../../lib/api.js");
  return { ...actual, api: (...args: unknown[]) => mockApi(...args) };
});
vi.mock("../../lib/analytics.js", () => ({ track: () => {} }));

import Services from "./Services";
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

function buttonWithText(needle: string): HTMLButtonElement {
  const hit = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes(needle));
  if (!hit) throw new Error(`no button containing "${needle}"`);
  return hit as HTMLButtonElement;
}

function countRequests(method: string, path: string): number {
  return calls.filter((c) => c.method === method && c.path === path).length;
}

const NATIVE_VALUE_SETTER = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
const NATIVE_SELECT_SETTER = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;

async function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const setter = el instanceof HTMLSelectElement ? NATIVE_SELECT_SETTER : NATIVE_VALUE_SETTER;
    if (setter) setter.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
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

describe("features/services — catalogue and booking (F-29)", () => {
  it("renders the catalogue from its own read and offers a prompt as the empty farm option", async () => {
    const { unmount } = mount(
      <MemoryRouter>
        <Services />
      </MemoryRouter>
    );
    await flush();

    expect(document.body.textContent).toContain("ট্রাক্টর ভাড়া");

    // Open the booking dialog: the empty farm option must name the action, not
    // repeat the field's label above it.
    await act(async () => {
      buttonWithText(dict.bookNow.bn).click();
    });
    const farmSelect = document.querySelector<HTMLSelectElement>("#bk-farm");
    expect(farmSelect).toBeTruthy();
    expect(farmSelect!.querySelector('option[value=""]')?.textContent).toBe(dict.selectFarmPrompt.bn);
    unmount();
  });

  it("posts the booking and refetches the bookings list WITHOUT reloading the catalogue", async () => {
    const { unmount } = mount(
      <MemoryRouter>
        <Services />
      </MemoryRouter>
    );
    await flush();
    expect(countRequests("GET", "/services")).toBe(1);

    await act(async () => {
      buttonWithText(dict.bookNow.bn).click();
    });
    await setValue(document.querySelector<HTMLSelectElement>("#bk-farm")!, "f1");
    const dateInput = document.querySelector<HTMLInputElement>('input[name="date"]')!;
    const future = new Date(Date.now() + 24 * 3600 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    await setValue(
      dateInput,
      `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`
    );
    await setValue(document.querySelector<HTMLInputElement>('input[name="area"]')!, "1.5");

    await act(async () => {
      buttonWithText(dict.submit.bn).click();
    });
    await flush();

    const post = calls.find((c) => c.method === "POST" && c.path === "/bookings");
    expect(post).toBeTruthy();
    expect(post!.body).toMatchObject({ farmId: "f1", serviceId: "s1", areaBigha: 1.5 });
    // The bookings family was invalidated — the list refetched…
    expect(countRequests("GET", "/bookings")).toBe(2);
    // …and the catalogue was not: nothing about POST /bookings changes a service row.
    expect(countRequests("GET", "/services")).toBe(1);
    unmount();
  });
});
