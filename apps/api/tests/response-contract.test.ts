import { describe, expect, it } from "vitest";
import request from "supertest";
import fs, { rmSync } from "node:fs";
import path from "node:path";
import { app, registerFarmer, createUserWithRole, createFarmWithCrop, getAdmin, uniquePhone } from "./helpers.js";
import { uploadImage, tinyPng } from "./upload-helper.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * Response-shape contract guard.
 *
 * The web app types every API response from one file (`apps/web/src/lib/api-types.ts`).
 * The two can drift silently — that is how an order-history screen spent months
 * reading `item.product.name` while the API sent `nameSnapshot`, crashing only when a
 * user expanded an order. TypeScript cannot see across the wire, so this test closes
 * the gap from the API side: it records the **key structure** (not the values) of
 * every response the web consumes and fails when that structure changes.
 *
 * When this test fails, the fix is a decision, not a reflex:
 *   1. read the diff — a key that disappeared is a breaking change for a client;
 *   2. update `contracts/api-response-shapes.json` (the committed record),
 *   3. update `apps/web/src/lib/api-types.ts` to match,
 *   4. update the consuming feature in the same PR.
 * All four belong in one commit, which is the point.
 *
 * F-68 (2026-11-10 audit): the fixture had `array(empty)` for cart, disease/cases
 * and payments — element shapes unguarded because checkout emptied the cart and
 * no disease case or payment existed when the probes ran — and the endpoints the
 * web actually calls for sessions (`auth/login`, `auth/register`), advisory,
 * payment intent/status and the admin analytics summary were absent entirely.
 * The seeding below now leaves a real element in every list, and the second test
 * is a checked list: a new endpoint documented in api-types.ts fails here until
 * it has a probe or an explicit exemption *with a reason*.
 *
 * Deliberately NOT asserted: field order, nullability of a populated row (a value can
 * be null in a way we cannot force in a fixture), and any endpoint the web does not
 * consume.
 */

/** "a.b[]" style signature: every key path, tagged with a coarse type. */
type Shape = Record<string, string>;

function tag(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function shapeOf(value: unknown, prefix = "", out: Shape = {}): Shape {
  if (Array.isArray(value)) {
    const first = value.find((v) => v !== null && v !== undefined);
    out[prefix ? `${prefix}[]` : "[]"] = first === undefined ? "array(empty)" : `array<${tag(first)}>`;
    if (first !== undefined && typeof first === "object") shapeOf(first, `${prefix}[]`, out);
    return out;
  }
  if (value === null) {
    out[prefix] = "null";
    return out;
  }
  if (typeof value === "object") {
    if (prefix) out[prefix] = "object";
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // `undefined` means the key was absent from the JSON — that is itself part of
      // the contract for optional fields (e.g. payment intent's redirectUrl).
      if (v === undefined) continue;
      shapeOf(v, prefix ? `${prefix}.${k}` : k, out);
    }
    return out;
  }
  out[prefix] = typeof value;
  return out;
}

/** Sorted, so the fixture diff shows real changes rather than key order. */
/**
 * A key whose value is `null` in one run may hold a real value in another (a fresh
 * user has no `cancelReason`, a cancelled order does). Treating `null` as "any scalar"
 * keeps the guard about **structure** — which keys exist — instead of about fixture
 * luck, while a key that disappears still fails.
 */
function normalizeForCompare(lines: string[]): string[] {
  return lines.map((l) => (l.endsWith(": null") ? l.replace(/: null$/, ": any") : l));
}

function signature(body: unknown): string[] {
  const shape = shapeOf(body);
  return Object.keys(shape)
    .sort()
    .map((k) => `${k}: ${shape[k]}`);
}

const FIXTURE = path.resolve(__dirname, "../../../contracts/api-response-shapes.json");

function loadFixture(): Record<string, string[]> {
  return JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Record<string, string[]>;
}

/** A probe can be a live request or a response already captured during seeding. */
type ProbeResponse = { status: number; body: { data?: unknown } };
type Probe = { name: string; run: () => PromiseLike<ProbeResponse>; ok?: number[] };

describe("API response shapes consumed by the web app", () => {
  it("match the committed contract fixture", async () => {
    const farmer = await registerFarmer();
    const farm = await createFarmWithCrop(farmer.accessToken, "ধান", 30);
    const admin = await getAdmin();
    await createUserWithRole("PROCUREMENT_MANAGER"); // gives /procurement data to list

    const auth = { Authorization: `Bearer ${farmer.accessToken}` };
    const adminAuth = { Authorization: `Bearer ${admin.accessToken}` };

    // Seed a little data so list endpoints return populated elements: an empty array
    // would make the shape assertion vacuous.
    const productId = await probeProductId(adminAuth);
    const cartAdd = await request(app).post("/api/v1/cart/items").set(auth).send({ productId, qty: 1 });
    const order = await request(app).post("/api/v1/orders/checkout").set(auth).send({ shippingAddress: "গ্রাম: টেস্ট, রংপুর" });
    // Checkout consumed the cart, so put a line back: the cart probe below must see a
    // populated item or its element shape is `array(empty)` and guards nothing (F-68).
    await request(app).post("/api/v1/cart/items").set(auth).send({ productId, qty: 1 });
    const procurementOffer = await request(app)
      .post("/api/v1/procurement/offers")
      .set(auth)
      .send({ farmId: farm.farmId, cropName: "RICE", quantityKg: 100, qualityGrade: "A", moisturePct: 12 });
    const service = await request(app).get("/api/v1/services").set(auth);
    if (service.body.data?.[0]) {
      await request(app).post("/api/v1/bookings").set(auth).send({ farmId: farm.farmId, serviceId: service.body.data[0].id, scheduledFor: new Date(Date.now() + 86400000).toISOString(), areaBigha: 1 });
    }
    await request(app).post("/api/v1/ai/advisory").set(auth).send({ question: "ধানের সেচ কখন দিতে হয়?" });
    const history = await request(app).get("/api/v1/ai/history").set(auth);
    const advisoryId = history.body.data?.[0]?.id as string | undefined;

    // `/wallet/withdrawals` and `/admin/withdrawals` are the same rows: without one, the
    // list is empty and the guard would be comparing nothing (a fixture generated when
    // an earlier suite happened to leave a row behind is how this guard first went
    // flaky). Credits are seeded directly — the payout path itself is covered by the
    // journey and concurrency suites.
    await prisma.wallet.upsert({
      where: { userId: farmer.user.id },
      update: { balancePaisa: { increment: 50_000 } },
      create: { userId: farmer.user.id, balancePaisa: 50_000 },
    });
    // One ledger row to match, so wallet.transactions has a real element shape
    // (same F-68 class): a hold-based withdrawal leaves the ledger empty until
    // payout, and an empty array guards no keys.
    await prisma.walletTransaction.create({
      data: { userId: farmer.user.id, direction: "CREDIT", amountPaisa: 50_000, balanceAfterPaisa: 50_000, reason: "contract-probe opening" },
    });
    await request(app).post("/api/v1/wallet/withdrawals").set(auth).send({ amountPaisa: 10_000, channel: "BKASH" });

    // A registration can only happen once per phone, so its session shape is captured
    // here rather than re-fetched in the probe list (F-68).
    const registerRes = await request(app)
      .post("/api/v1/auth/register")
      .send({ fullName: "Contract Probe", phone: uniquePhone(), password: "Test@1234", langPref: "bn", consent: true });

    // A real element for GET /disease/cases (F-68); the upload response is the same
    // case element and is probed too. The stored image is removed after the run.
    const diseaseCase = await uploadImage(farmer.accessToken, tinyPng(), "image/png", "contract-probe.png");
    const diseaseImagePath = diseaseCase.body?.data?.imagePath as string | undefined;

    // An analytics event so GET /admin/analytics/summary has an element shape too (F-68).
    await request(app).post("/api/v1/analytics/events").set(auth).send({ events: [{ name: "route_view", props: { screen: "contract-probe" } }] });

    // The order's intent, which also gives GET /payments a real element (F-68).
    const intent = await request(app).post("/api/v1/payments/intent").set(auth).send({ purposeType: "ORDER", purposeId: order.body.data.id });
    const paymentId = intent.body?.data?.paymentId as string | undefined;

    const probes: Probe[] = [
      { name: "auth/me", run: () => request(app).get("/api/v1/auth/me").set(auth) },
      { name: "auth/login", run: () => request(app).post("/api/v1/auth/login").send({ phone: farmer.phone, password: farmer.plainPassword }) },
      { name: "auth/register", run: async () => registerRes, ok: [201] },
      { name: "auth/me:patch", run: () => request(app).patch("/api/v1/auth/me").set(auth).send({ fullName: farmer.user.fullName ?? "Test Farmer" }) },
      { name: "farms", run: () => request(app).get("/api/v1/farms").set(auth) },
      { name: "farms/:id/plots", run: () => request(app).get(`/api/v1/farms/${farm.farmId}/plots`).set(auth) },
      { name: "farms/crops", run: () => request(app).get("/api/v1/farms/crops").set(auth) },
      { name: "weather", run: () => request(app).get("/api/v1/weather?lat=25.74&lng=89.27").set(auth) },
      { name: "ai/history", run: () => request(app).get("/api/v1/ai/history").set(auth) },
      // A KB-matching question: the citation arrays must be non-empty in the
      // fixture or their element shapes are unguarded (same class as F-68).
      { name: "ai/advisory", run: () => request(app).post("/api/v1/ai/advisory").set(auth).send({ question: "ধানের সেচ কখন দিতে হয়?" }) },
      { name: "ai/history/:id/feedback", run: () => request(app).post(`/api/v1/ai/history/${advisoryId}/feedback`).set(auth).send({ reason: "The answer missed my question" }) },
      { name: "disease/cases", run: () => request(app).get("/api/v1/disease/cases").set(auth) },
      { name: "disease/cases:create", run: async () => diseaseCase, ok: [201] },
      { name: "products", run: () => request(app).get("/api/v1/products?pageSize=5").set(auth) },
      { name: "cart", run: () => request(app).get("/api/v1/cart").set(auth) },
      { name: "cart/items", run: async () => cartAdd, ok: [201] },
      { name: "orders", run: () => request(app).get("/api/v1/orders").set(auth) },
      { name: "orders/:id", run: () => request(app).get(`/api/v1/orders/${order.body.data.id}`).set(auth) },
      { name: "services", run: () => request(app).get("/api/v1/services").set(auth) },
      { name: "bookings", run: () => request(app).get("/api/v1/bookings").set(auth) },
      { name: "procurement", run: () => request(app).get("/api/v1/procurement").set(auth) },
      { name: "procurement/offers", run: async () => procurementOffer, ok: [201] },
      { name: "wallet", run: () => request(app).get("/api/v1/wallet").set(auth) },
      { name: "wallet/summary", run: () => request(app).get("/api/v1/wallet/summary").set(auth) },
      { name: "wallet/withdrawals", run: () => request(app).get("/api/v1/wallet/withdrawals").set(auth) },
      { name: "payments", run: () => request(app).get("/api/v1/payments").set(auth) },
      { name: "payments/intent", run: async () => intent, ok: [201] },
      { name: "payments/:id/status", run: () => request(app).get(`/api/v1/payments/${paymentId}/status`).set(auth) },
      { name: "membership/plans", run: () => request(app).get("/api/v1/membership/plans").set(auth) },
      { name: "notifications", run: () => request(app).get("/api/v1/notifications").set(auth) },
      { name: "admin/metrics", run: () => request(app).get("/api/v1/admin/metrics").set(adminAuth) },
      { name: "admin/analytics/summary", run: () => request(app).get("/api/v1/admin/analytics/summary").set(adminAuth) },
      { name: "admin/users", run: () => request(app).get("/api/v1/admin/users?pageSize=5").set(adminAuth) },
      { name: "admin/users:patch", run: () => request(app).patch(`/api/v1/admin/users/${farmer.user.id}`).set(adminAuth).send({ region: "rangpur" }) },
      { name: "admin/audit-logs", run: () => request(app).get("/api/v1/admin/audit-logs?pageSize=5").set(adminAuth) },
      { name: "admin/withdrawals", run: () => request(app).get("/api/v1/admin/withdrawals?status=PENDING").set(adminAuth) },
    ];

    /**
     * Regeneration mode: `WRITE_CONTRACT_FIXTURE=1 npx vitest run tests/response-contract.test.ts`
     * rewrites the fixture from live responses. Use it when you have *decided* to
     * change a contract — never to make a red build green. A fixture updated without
     * the web types and the consuming feature is exactly the drift this guards against.
     */
    const regenerating = process.env.WRITE_CONTRACT_FIXTURE === "1";
    const fixture = regenerating ? ({} as Record<string, string[]>) : loadFixture();
    const observed: Record<string, string[]> = {};
    const problems: string[] = [];

    for (const probe of probes) {
      const res = await probe.run();
      const okStatuses = probe.ok ?? [200];
      if (!okStatuses.includes(res.status)) {
        problems.push(`${probe.name}: expected ${okStatuses.join("/")}, got ${res.status} — the probe itself is stale`);
        continue;
      }
      observed[probe.name] = signature(res.body.data);
      if (regenerating) continue;
      const expected = fixture[probe.name];
      if (!expected) {
        problems.push(`${probe.name}: not in the fixture (new endpoint? add it after reviewing the shape)`);
        continue;
      }
      const added = normalizeForCompare(observed[probe.name]!).filter((line) => !normalizeForCompare(expected).includes(line));
      const removed = normalizeForCompare(expected).filter((line) => !normalizeForCompare(observed[probe.name]!).includes(line));
      if (added.length || removed.length) {
        problems.push(
          [
            `${probe.name}: response shape changed`,
            added.length ? `    + ${added.join("\n    + ")}` : "",
            removed.length ? `    - ${removed.join("\n    - ")}` : "",
            `    → update contracts/api-response-shapes.json AND apps/web/src/lib/api-types.ts together`,
          ]
            .filter(Boolean)
            .join("\n")
        );
      }
    }

    // The uploaded probe image is test litter either way.
    if (diseaseImagePath) rmSync(path.resolve(diseaseImagePath), { force: true });

    if (regenerating) {
      // A probe that answered the wrong status was skipped above. Writing the
      // fixture anyway would silently DROP that endpoint's coverage — the exact
      // failure mode this file exists to prevent.
      if (problems.length) throw new Error(`[response-contract] probes failed; fixture NOT written:\n${problems.join("\n")}`);
      const ordered: Record<string, string[]> = {};
      for (const key of Object.keys(observed).sort()) ordered[key] = observed[key]!;
      fs.writeFileSync(FIXTURE, JSON.stringify(ordered, null, 2) + "\n", "utf8");
      console.warn(`[response-contract] fixture rewritten: ${Object.keys(ordered).length} endpoints`);
      console.warn("[response-contract] now update apps/web/src/lib/api-types.ts and the consuming feature in the same commit");
      return;
    }

    expect(problems, problems.join("\n")).toEqual([]);
  });

  /**
   * F-68: the probe list above used to be hand-maintained, so an endpoint added to
   * the web's own contract file could go unprobed forever. This is the checked list:
   * every endpoint documented in `api-types.ts` must map to a probe (or carry an
   * explicit exemption with a reason). Document a new endpoint there without a probe
   * here and this fails.
   */
  it("probes every endpoint documented in the web contract file, or records why not", () => {
    const typesSrc = fs.readFileSync(path.resolve(__dirname, "../../web/src/lib/api-types.ts"), "utf8");
    const documented = new Set<string>();
    for (const line of typesSrc.split(/\r?\n/)) {
      if (!/^\s*\/\*\*/.test(line) && !/^\s*\* /.test(line)) continue;
      for (const m of line.matchAll(/\b(GET|POST|PATCH|PUT|DELETE) (\/[^\s—·(),.;\x60]+)/g)) {
        documented.add(`${m[1]} ${m[2]}`);
      }
    }

    /** documented endpoint → fixture key produced by the probe list above. */
    const coveredByProbe: Record<string, string> = {
      "GET /auth/me": "auth/me",
      "POST /auth/login": "auth/login",
      "POST /auth/register": "auth/register",
      "PATCH /auth/me": "auth/me:patch",
      "GET /farms": "farms",
      "GET /farms/:id/plots": "farms/:id/plots",
      "GET /farms/crops": "farms/crops",
      "GET /weather": "weather",
      "GET /ai/history": "ai/history",
      "POST /ai/advisory": "ai/advisory",
      "POST /ai/history/:id/feedback": "ai/history/:id/feedback",
      "GET /disease/cases": "disease/cases",
      "POST /disease/cases": "disease/cases:create",
      "GET /products": "products",
      "GET /cart": "cart",
      "POST /cart/items": "cart/items",
      "GET /orders": "orders",
      "GET /orders/:id": "orders/:id",
      "GET /procurement": "procurement",
      "POST /procurement/offers": "procurement/offers",
      "GET /wallet": "wallet",
      "GET /wallet/summary": "wallet/summary",
      "GET /payments": "payments",
      "POST /payments/intent": "payments/intent",
      "GET /payments/:id/status": "payments/:id/status",
      "GET /membership/plans": "membership/plans",
      "GET /notifications": "notifications",
      "PATCH /admin/users/:id": "admin/users:patch",
    };

    /** Documented endpoints deliberately not probed — each needs a reason. */
    const exempt: Record<string, string> = {
      "POST /auth/otp/request":
        "the response carries `devCode` only outside production (api-types.ts); recording it would bake a test-only key into the fixture. OTP request/verify is asserted end-to-end by journey-auth.",
    };

    const fixture = loadFixture();
    const problems: string[] = [];
    for (const endpoint of documented) {
      if (endpoint in exempt) continue;
      const key = coveredByProbe[endpoint];
      if (!key) {
        problems.push(`${endpoint} is documented in api-types.ts but has no probe — add one, or an exemption with a reason`);
      } else if (!(key in fixture)) {
        problems.push(`${endpoint} maps to fixture key "${key}", which the fixture does not contain — regenerate it`);
      }
    }
    // …and the map must not rot: a mapping for an endpoint no longer documented in
    // api-types.ts is stale and should be removed.
    for (const endpoint of Object.keys(coveredByProbe)) {
      if (!documented.has(endpoint)) problems.push(`probe map entry "${endpoint}" is no longer documented in api-types.ts — remove it`);
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });
});

/**
 * A product the probe can actually buy.
 *
 * This used to take `items[0]` from the catalog list — which is ordered
 * `createdAt desc`, so it took whatever row another suite had created most
 * recently. `concurrency.test.ts` deliberately creates a "Limited Item" and sells
 * it out to prove the stock guard, so whenever that suite ran first the probe's
 * cart-add failed with "Insufficient stock", the cart stayed empty, checkout
 * returned no `data`, and the probe died reading `order.body.data.id`. It failed
 * twice on 2026-10-18 (two local PostgreSQL runs, different file orders) and each
 * time presented as a product defect.
 *
 * The probe now provisions what it buys; the catalog fallback only runs if
 * creation is unavailable, and it filters for a product that actually has stock.
 */
async function probeProductId(adminHeaders: Record<string, string>): Promise<string> {
  const created = await request(app)
    .post("/api/v1/products")
    .set(adminHeaders)
    .send({
      sku: `CONTRACT-PROBE-${Date.now().toString(36)}`,
      name: "Contract probe product",
      category: "SEED",
      unit: "PACK",
      pricePaisa: 1_000,
      stockQty: 5,
    });
  const createdId = created.body?.data?.id;
  if (typeof createdId === "string") return createdId;

  const res = await request(app).get("/api/v1/products?pageSize=50").set(adminHeaders);
  const item = res.body.data?.items?.find((p: { stockQty: number }) => p.stockQty >= 1);
  if (!item) {
    throw new Error(
      `no purchasable product for the contract probe (product creation answered ${created.status}: ` +
        `${JSON.stringify(created.body).slice(0, 160)})`
    );
  }
  return item.id;
}
