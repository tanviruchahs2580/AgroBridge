import { describe, expect, it } from "vitest";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { app, registerFarmer, createUserWithRole, createFarmWithCrop, getAdmin } from "./helpers.js";
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
    await request(app).post("/api/v1/cart/items").set(auth).send({ productId: (await firstProductId(auth)).id, qty: 1 });
    const order = await request(app).post("/api/v1/orders/checkout").set(auth).send({ shippingAddress: "গ্রাম: টেস্ট, রংপুর" });
    await request(app).post("/api/v1/procurement/offers").set(auth).send({ farmId: farm.farmId, cropName: "RICE", quantityKg: 100, qualityGrade: "A", moisturePct: 12 });
    const service = await request(app).get("/api/v1/services").set(auth);
    if (service.body.data?.[0]) {
      await request(app).post("/api/v1/bookings").set(auth).send({ farmId: farm.farmId, serviceId: service.body.data[0].id, scheduledFor: new Date(Date.now() + 86400000).toISOString(), areaBigha: 1 });
    }
    await request(app).post("/api/v1/ai/advisory").set(auth).send({ question: "ধানের সেচ কখন দিতে হয়?" });

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
    await request(app).post("/api/v1/wallet/withdrawals").set(auth).send({ amountPaisa: 10_000, channel: "BKASH" });

    const probes: [string, string, Record<string, string>][] = [
      ["auth/me", "/api/v1/auth/me", auth],
      ["farms", "/api/v1/farms", auth],
      [`farms/:id/plots`, `/api/v1/farms/${farm.farmId}/plots`, auth],
      ["farms/crops", "/api/v1/farms/crops", auth],
      ["weather", "/api/v1/weather?lat=25.74&lng=89.27", auth],
      ["ai/history", "/api/v1/ai/history", auth],
      ["disease/cases", "/api/v1/disease/cases", auth],
      ["products", "/api/v1/products?pageSize=5", auth],
      ["cart", "/api/v1/cart", auth],
      ["orders", "/api/v1/orders", auth],
      ["orders/:id", `/api/v1/orders/${order.body.data.id}`, auth],
      ["services", "/api/v1/services", auth],
      ["bookings", "/api/v1/bookings", auth],
      ["procurement", "/api/v1/procurement", auth],
      ["wallet", "/api/v1/wallet", auth],
      ["wallet/summary", "/api/v1/wallet/summary", auth],
      ["wallet/withdrawals", "/api/v1/wallet/withdrawals", auth],
      ["payments", "/api/v1/payments", auth],
      ["membership/plans", "/api/v1/membership/plans", auth],
      ["notifications", "/api/v1/notifications", auth],
      ["admin/metrics", "/api/v1/admin/metrics", adminAuth],
      ["admin/users", "/api/v1/admin/users?pageSize=5", adminAuth],
      ["admin/audit-logs", "/api/v1/admin/audit-logs?pageSize=5", adminAuth],
      ["admin/withdrawals", "/api/v1/admin/withdrawals?status=PENDING", adminAuth],
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

    for (const [name, url, headers] of probes) {
      const res = await request(app).get(url).set(headers);
      if (res.status !== 200) {
        problems.push(`${name}: expected 200, got ${res.status} — the probe itself is stale`);
        continue;
      }
      observed[name] = signature(res.body.data);
      if (regenerating) continue;
      const expected = fixture[name];
      if (!expected) {
        problems.push(`${name}: not in the fixture (new endpoint? add it after reviewing the shape)`);
        continue;
      }
      const added = normalizeForCompare(observed[name]!).filter((line) => !normalizeForCompare(expected).includes(line));
      const removed = normalizeForCompare(expected).filter((line) => !normalizeForCompare(observed[name]!).includes(line));
      if (added.length || removed.length) {
        problems.push(
          [
            `${name}: response shape changed`,
            added.length ? `    + ${added.join("\n    + ")}` : "",
            removed.length ? `    - ${removed.join("\n    - ")}` : "",
            `    → update contracts/api-response-shapes.json AND apps/web/src/lib/api-types.ts together`,
          ]
            .filter(Boolean)
            .join("\n")
        );
      }
    }

    if (regenerating) {
      const ordered: Record<string, string[]> = {};
      for (const key of Object.keys(observed).sort()) ordered[key] = observed[key]!;
      fs.writeFileSync(FIXTURE, JSON.stringify(ordered, null, 2) + "\n", "utf8");
      console.warn(`[response-contract] fixture rewritten: ${Object.keys(ordered).length} endpoints`);
      console.warn("[response-contract] now update apps/web/src/lib/api-types.ts and the consuming feature in the same commit");
      return;
    }

    expect(problems, problems.join("\n")).toEqual([]);
  });
});

async function firstProductId(headers: Record<string, string>): Promise<{ id: string }> {
  const res = await request(app).get("/api/v1/products?pageSize=5").set(headers);
  const item = res.body.data?.items?.[0];
  if (!item) throw new Error("no seeded product available for the contract probe");
  return item;
}
