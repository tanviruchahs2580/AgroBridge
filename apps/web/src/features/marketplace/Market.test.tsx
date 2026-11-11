/**
 * Marketplace screen: the catalogue pager and the cart write path (F-29 — this
 * file was at 0% coverage while the screen is 170 lines of real UI — plus F-39,
 * the truncation defect).
 *
 * The bug under test: `GET /products` has always answered a Paged payload
 * (page/pageSize/total/totalPages) and the screen requested page 1 only, with no
 * pager and no total — a catalogue with 120 products rendered 50 of them and
 * nothing on screen said the rest existed. These tests drive the real
 * useResource against a canned transport, so the request URL, the pager and the
 * cart write are all observable rather than asserted from state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";

const calls: { method: string; path: string; body?: unknown }[] = [];
let productTotal = 0;

function page(pageNo: number, pageSize = 50) {
  const start = (pageNo - 1) * pageSize;
  const remaining = Math.max(0, productTotal - start);
  const count = Math.min(pageSize, remaining);
  return {
    items: Array.from({ length: count }, (_, i) => ({
      id: `p${start + i + 1}`,
      sku: `SKU-${start + i + 1}`,
      name: `পণ্য ${start + i + 1}`,
      category: "SEED",
      description: null,
      unit: "kg",
      pricePaisa: 12000,
      stockQty: 25,
      supplier: null,
      cropRelevance: null,
      expiryDate: null,
    })),
    page: pageNo,
    pageSize,
    total: productTotal,
    totalPages: Math.max(1, Math.ceil(productTotal / pageSize)),
  };
}

const mockApi = vi.fn((...args: unknown[]) => {
  const method = args[0] as string;
  const path = args[1] as string;
  calls.push({ method, path, body: args[2] });
  if (method === "GET" && path.startsWith("/products")) {
    const pageNo = Number(new URLSearchParams(path.split("?")[1] ?? "").get("page") ?? "1");
    return Promise.resolve(page(pageNo));
  }
  if (method === "GET" && path === "/cart") return Promise.resolve({ items: [], subtotalPaisa: 0 });
  if (method === "GET" && path === "/auth/me") return Promise.resolve({ phone: "01712345678", farmerProfile: null });
  if (method === "POST" && path === "/cart/items") return Promise.resolve({ ok: true });
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

import Market from "./Market";
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

/** Catalogue requests in order. */
function productRequests(): string[] {
  return calls.filter((c) => c.path.startsWith("/products")).map((c) => c.path);
}

beforeEach(() => {
  calls.length = 0;
  productTotal = 0;
  document.body.innerHTML = "";
  mockApi.mockClear();
});

afterEach(() => {
  while (mountedRoots.length) mountedRoots.pop()!.unmount();
  document.body.innerHTML = "";
});

describe("features/marketplace — catalogue pager (F-39)", () => {
  it("renders page 1 with a pager built from total/totalPages, and pages forward", async () => {
    productTotal = 120; // 3 pages at pageSize 50 — the recorded shape of the defect
    const { unmount } = mount(<Market />);
    await flush();

    // Page 1: the window is visible AND admitted to be a window.
    expect(document.body.textContent).toContain("পণ্য 1");
    expect(document.body.textContent).toContain("পণ্য 50");
    expect(document.body.textContent).not.toContain("পণ্য 51");
    expect(productRequests()[0]).toContain("page=1");
    expect(document.body.textContent).toContain(dict.pagerPageOf.bn.replace("{page}", "1").replace("{total}", "3"));
    expect(document.body.textContent).toContain(dict.marketTotalProducts.bn.replace("{n}", "120"));
    // Nothing before page 1.
    expect(buttonWithText(dict.pagerPrev.bn).disabled).toBe(true);
    expect(buttonWithText(dict.pagerNext.bn).disabled).toBe(false);

    await act(async () => {
      buttonWithText(dict.pagerNext.bn).click();
    });
    await flush();

    expect(productRequests().at(-1)).toContain("page=2");
    expect(document.body.textContent).toContain("পণ্য 51");
    expect(document.body.textContent).not.toContain("পণ্য 50");
    expect(buttonWithText(dict.pagerPrev.bn).disabled).toBe(false);
    unmount();
  });

  it("resets to page 1 when the category chip changes", async () => {
    productTotal = 120;
    const { unmount } = mount(<Market />);
    await flush();
    await act(async () => {
      buttonWithText(dict.pagerNext.bn).click();
    });
    await flush();
    expect(productRequests().at(-1)).toContain("page=2");

    // The page must not survive a chip change, or a narrower category renders an
    // empty grid while the pager still claims page 2.
    await act(async () => {
      buttonWithText(dict.catSEED.bn).click();
    });
    await flush();
    const last = productRequests().at(-1) ?? "";
    expect(last).toContain("page=1");
    expect(last).toContain("category=SEED");
    unmount();
  }, 30_000);

  it("renders the position and no pager buttons when the catalogue fits one page", async () => {
    productTotal = 3;
    const { unmount } = mount(<Market />);
    await flush();
    expect(document.body.textContent).toContain("পণ্য 3");
    expect(document.body.textContent).toContain(dict.pagerPageOf.bn.replace("{page}", "1").replace("{total}", "1"));
    const next = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes(dict.pagerNext.bn));
    expect(next).toBeUndefined();
    unmount();
  });
});

describe("features/marketplace — cart write path (F-29)", () => {
  it("adds a product to the cart and acknowledges it on the card", async () => {
    productTotal = 2;
    const { unmount } = mount(<Market />);
    await flush();

    const addButton = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes(dict.addToCart.bn));
    expect(addButton).toBeTruthy();
    await act(async () => {
      addButton!.click();
    });
    await flush();

    // Absolute quantity upsert, the contract POST /cart/items implements.
    expect(mockApi).toHaveBeenCalledWith("POST", "/cart/items", { productId: "p1", qty: 1 });
    // Transient success state on the grid, not a silent no-op.
    expect(document.body.textContent).toContain(dict.addedToCart.bn);
    unmount();
  });
});
