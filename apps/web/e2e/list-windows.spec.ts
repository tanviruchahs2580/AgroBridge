import { test, expect } from "@playwright/test";
import { DEMO, login } from "./scenario-helpers";

/**
 * F-39 in a real browser: a long list is a window, not the whole world.
 *
 * The two defects were identical in shape — the API reported how much data it
 * had, and the UI rendered a silent slice of it:
 *   - `GET /products` answers a Paged payload (page/pageSize/total/totalPages)
 *     and the catalogue requested page 1 only, with no pager;
 *   - `GET /orders` is capped (`take: 100`) and announces the real size in
 *     `X-Total-Count`, which the UI could not even read.
 *
 * The API responses are fulfilled here so both cases are deterministic at any
 * database size — the seeded catalogue has 8 products and could never show a
 * second page. The requests the page makes are recorded, so the assertions
 * cover the URLs as well as the pixels.
 */
test.describe("Long lists state their window (F-39)", () => {
  test("the catalogue pager walks the page count the API reports", async ({ page }) => {
    await login(page, DEMO.farmer);

    const productRequests: string[] = [];
    const TOTAL = 120; // 3 pages at pageSize 50 — the recorded shape of the defect
    await page.route("**/api/v1/products*", async (route) => {
      const url = new URL(route.request().url());
      productRequests.push(url.pathname + url.search);
      const pageNo = Number(url.searchParams.get("page") ?? "1");
      const pageSize = Number(url.searchParams.get("pageSize") ?? "50");
      const start = (pageNo - 1) * pageSize;
      const count = Math.max(0, Math.min(pageSize, TOTAL - start));
      const items = Array.from({ length: count }, (_, i) => ({
        id: `probe-p${start + i + 1}`,
        sku: `SKU-${start + i + 1}`,
        name: `পরীক্ষা পণ্য ${start + i + 1}`,
        category: "SEED",
        description: null,
        unit: "kg",
        pricePaisa: 12000,
        stockQty: 25,
        supplier: null,
        cropRelevance: null,
        expiryDate: null,
      }));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: { items, page: pageNo, pageSize, total: TOTAL, totalPages: Math.ceil(TOTAL / pageSize) },
        }),
      });
    });

    await page.goto("/market");
    await expect(page.getByText("পরীক্ষা পণ্য 1", { exact: true }).first()).toBeVisible();
    expect(productRequests[0]).toContain("page=1");
    // The window is admitted: position of 3, and the server's own total. The
    // counts interpolate as ASCII digits, like every other `{n}` key in the
    // dictionary (`svcCount`, `marketTotalProducts`) — the copy around them is
    // Bengali.
    await expect(page.getByText(/পাতা 1\s*\/\s*3|Page 1 of 3/)).toBeVisible();
    await expect(page.getByText(/মোট 120টি পণ্য|120 products in total/)).toBeVisible();
    // Page 1 is the beginning: no previous page to offer.
    await expect(page.getByRole("button", { name: /আগের|Previous/ })).toBeDisabled();

    await page.getByRole("button", { name: /পরের|Next/ }).click();
    await expect(page.getByText("পরীক্ষা পণ্য 51", { exact: true }).first()).toBeVisible();
    expect(productRequests.at(-1)).toContain("page=2");
    await expect(page.getByText(/পাতা 2\s*\/\s*3|Page 2 of 3/)).toBeVisible();
    await expect(page.getByRole("button", { name: /আগের|Previous/ })).toBeEnabled();
  });

  test("the orders list states the truncation X-Total-Count reports", async ({ page }) => {
    await login(page, DEMO.farmer);

    await page.route("**/api/v1/orders", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "X-Total-Count": "7" },
        body: JSON.stringify({
          ok: true,
          data: [
            { id: "o1", orderNo: "ORD-PROBE-1", status: "DELIVERED", paymentStatus: "PAID", totalPaisa: 150000, createdAt: "2026-10-01T00:00:00.000Z", items: [] },
            { id: "o2", orderNo: "ORD-PROBE-2", status: "DELIVERED", paymentStatus: "PAID", totalPaisa: 150000, createdAt: "2026-10-02T00:00:00.000Z", items: [] },
          ],
        }),
      });
    });

    await page.goto("/orders");
    await expect(page.getByText("ORD-PROBE-1")).toBeVisible();
    // Two rows, seven orders: the header is the only truth for that, and the
    // screen must say so rather than present the slice as the history.
    await expect(
      page.getByText(/সর্বশেষ 2টি অর্ডার দেখানো হচ্ছে|Showing your latest 2 orders/)
    ).toBeVisible();
  });
});
