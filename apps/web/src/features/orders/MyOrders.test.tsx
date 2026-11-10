/**
 * Feature test for the orders screen's derived UI (AUD-V3 F1: 11 of 14
 * feature directories had no unit tests — this covers one of the most-visited
 * screens). Mounts the real MyOrders with a canned list through the real
 * useResource seam and asserts what the farmer actually sees: localized
 * status badges per order, tab filtering, and the honest empty state. No
 * network, no providers beyond the safe context defaults.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";

let ordersFixture: unknown[] = [];
/** X-Total-Count as the resource seam delivers it; null = header absent. */
let ordersTotalFixture: number | null = null;

vi.mock("../../lib/session", () => ({
  useSession: () => ({ session: { lang: "bn", fullName: "Test", role: "FARMER" }, refresh: async () => {} }),
}));
vi.mock("../../lib/api.js", () => ({
  api: () => Promise.resolve([]),
  setTokens: () => {},
  clearTokens: () => {},
  hasToken: () => false,
  API_BASE: "/api/v1",
}));
vi.mock("../../lib/analytics.js", () => ({ track: () => {} }));
vi.mock("../../lib/useResource.js", () => ({
  // The real hook's data is the API response plus its X-Total-Count (see
  // OrdersPage in MyOrders.tsx), so the seam hands back the same shape.
  useResource: () => ({ data: { items: ordersFixture, total: ordersTotalFixture }, loading: false, error: null }),
  invalidate: () => {},
}));

import MyOrders from "./MyOrders";
import { dict, t } from "../../lib/i18n";
import { orderStatusLabel } from "../../lib/labels";

function mount(node: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return { unmount: () => act(() => root.unmount()) };
}

const order = (id: string, status: string, paymentStatus = "PAID") => ({
  id,
  orderNo: `ORD-${id}`,
  status,
  paymentStatus,
  totalPaisa: 150000,
  createdAt: "2026-10-01T00:00:00.000Z",
  items: [{ id: "i1", productName: "ইউরিয়া", qty: 2, pricePaisa: 75000 }],
});

beforeEach(() => {
  ordersFixture = [];
  ordersTotalFixture = null;
  document.body.innerHTML = "";
});

describe("features/orders — MyOrders derived UI", () => {
  it("renders each order with its localized status badge", () => {
    ordersFixture = [order("o1", "PAID"), order("o2", "SHIPPED", "UNPAID"), order("o3", "CANCELLED", "UNPAID")];
    mount(<MyOrders />);

    expect(document.body.textContent).toContain("ORD-o1");
    expect(document.body.textContent).toContain("ORD-o2");
    expect(document.body.textContent).toContain("ORD-o3");
    // Badges speak the dictionary's language for the status, in the session's bn.
    expect(document.body.textContent).toContain(orderStatusLabel("PAID", "bn"));
    expect(document.body.textContent).toContain(orderStatusLabel("SHIPPED", "bn"));
    expect(document.body.textContent).toContain(orderStatusLabel("CANCELLED", "bn"));
  });

  it("shows the honest empty state when there are no orders", () => {
    mount(<MyOrders />);
    expect(document.body.textContent).toContain(dict.ordEmptyTitle.bn);
  });

  it("tab filtering changes which orders are listed", () => {
    ordersFixture = [order("a1", "DELIVERED"), order("a2", "PENDING", "UNPAID")];
    mount(<MyOrders />);
    expect(document.body.textContent).toContain("ORD-a1");
    expect(document.body.textContent).toContain("ORD-a2");

    const deliveredTab = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent?.includes(dict.ordTabDelivered.bn)
    );
    expect(deliveredTab).toBeTruthy();
    act(() => deliveredTab!.click());
    expect(document.body.textContent).toContain("ORD-a1");
    expect(document.body.textContent).not.toContain("ORD-a2");
  });

  it("renders one screen heading through the shared PageHeader (fold-in: own h1 + legacy green-*)", () => {
    ordersFixture = [order("h9", "PAID")];
    mount(<MyOrders />);

    const h1s = Array.from(document.querySelectorAll("h1"));
    expect(h1s.length).toBe(1);
    expect(h1s[0]?.textContent).toBe(dict.myOrders.bn);
    // This screen used to hand-roll its h1 with the lucide icon inside it; the
    // shared PageHeader keeps the icon in its own decorative tile instead.
    expect(h1s[0]?.querySelector("svg")).toBeNull();
    expect(h1s[0]?.className).toContain("text-xl");
  });

  it("states the truncation when X-Total-Count exceeds the returned slice (F-39)", () => {
    ordersFixture = [order("t1", "PAID"), order("t2", "SHIPPED")];
    ordersTotalFixture = 7;
    mount(<MyOrders />);

    // The server's number (7) beats the array's length (2): the screen must say
    // the list is a window, not present the two rows as the whole history.
    expect(document.body.textContent).toContain(t("ordersTruncatedNotice", "bn", { shown: 2, total: 7 }));
  });

  it("does not claim truncation when the slice is the whole history (F-39)", () => {
    // The sentence's leading words, before the first placeholder: constant no
    // matter what counts are substituted, so it is the honest absence marker.
    const [noticePrefix] = dict.ordersTruncatedNotice.bn.split("{");

    ordersFixture = [order("w1", "PAID")];
    // Header absent (null) means the server did not vouch for a total.
    ordersTotalFixture = null;
    mount(<MyOrders />);
    expect(document.body.textContent).toContain("ORD-w1");
    expect(document.body.textContent).not.toContain(noticePrefix);

    ordersFixture = [order("w2", "PAID")];
    // Header equal to the row count is a complete list.
    ordersTotalFixture = 1;
    mount(<MyOrders />);
    expect(document.body.textContent).toContain("ORD-w2");
    expect(document.body.textContent).not.toContain(noticePrefix);
  });
});
