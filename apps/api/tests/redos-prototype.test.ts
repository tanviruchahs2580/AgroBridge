import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, uniquePhone } from "./helpers.js";
import { normalizeBdPhone } from "../src/shared/utils/phone.js";

/**
 * Hostile-body pins: payload shapes must not reach object prototypes, and
 * the phone validator must stay linear on pathological input.
 *
 * Prototype pollution: `__proto__` / `constructor.prototype` keys are sent as
 * raw JSON (a JS object literal would set the prototype instead of carrying
 * the key). The assertions are the observable contract — Object.prototype is
 * byte-identical before/after and the response never reflects the poison back
 * as data. Whether the value is rejected (400) or ignored (201) is the
 * endpoint's own business; polluting the process is not.
 *
 * ReDoS: the BD-phone normaliser runs anchored, single-character-class
 * regexes, so a 50k-char near-miss must return 400 immediately. The 1s box is
 * generous on purpose — it fails only on catastrophic backtracking, not on a
 * slow CI box.
 */

/** Raw JSON suffix carrying the pollution payloads, spliced into bodies. */
const POISON_SUFFIX = '"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"pollutedCtor":"yes"}}';

function poisonedBody(jsonWithoutClosingBrace: string): Record<string, unknown> {
  return JSON.parse(`{${jsonWithoutClosingBrace},${POISON_SUFFIX}}`) as Record<string, unknown>;
}

function prototypeSnapshot(): string {
  return Object.getOwnPropertyNames(Object.prototype).sort().join(",");
}

function expectNoPollution(snapshotBefore: string) {
  expect(prototypeSnapshot()).toBe(snapshotBefore);
  expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  expect(({} as Record<string, unknown>).pollutedCtor).toBeUndefined();
  expect(Object.prototype.hasOwnProperty.call(Object.prototype, "polluted")).toBe(false);
}

describe("prototype-pollution payloads are inert", () => {
  it("registration body with __proto__/constructor.prototype still registers normally", async () => {
    const before = prototypeSnapshot();
    const phone = uniquePhone();

    const res = await request(app)
      .post("/api/v1/auth/register")
      .send(poisonedBody(`"fullName":"Proto Probe","phone":"${phone}","password":"Test@1234","consent":true`));

    expect(res.status).toBe(201);
    expect(res.body.data.user.fullName).toBe("Proto Probe");
    expectNoPollution(before);

    // The account is a normal account — login with the same credentials works.
    const login = await request(app).post("/api/v1/auth/login").send({ phone, password: "Test@1234" });
    expect(login.status).toBe(200);
    expectNoPollution(before);
  });

  it("profile update body with pollution keys applies only the known fields", async () => {
    const before = prototypeSnapshot();
    const f = await registerFarmer();

    const res = await request(app)
      .patch("/api/v1/auth/me")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send(poisonedBody('"district":"রংপুর"'));

    expect(res.status).toBe(200);
    expect(res.body.data.farmerProfile.district).toBe("রংপুর");
    expectNoPollution(before);
  });

  it("checkout body with pollution keys creates (or refuses) a normal order", async () => {
    const before = prototypeSnapshot();
    const f = await registerFarmer();

    const list = await request(app).get("/api/v1/products?pageSize=50").set("Authorization", `Bearer ${f.accessToken}`);
    const product = (list.body.data.items as { id: string; stockQty: number }[]).find((p) => p.stockQty > 0);
    if (!product) throw new Error("seed catalog has no in-stock product");
    await request(app)
      .post("/api/v1/cart/items")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ productId: product.id, qty: 1 });

    const res = await request(app)
      .post("/api/v1/orders/checkout")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send(poisonedBody('"shippingAddress":"গ্রাম: টেস্ট, রংপুর"'));

    expect(res.status).toBe(201);
    expect(res.body.data.shippingAddress).toBe("গ্রাম: টেস্ট, রংপুর");
    expect(res.body.data).not.toHaveProperty("polluted");
    expectNoPollution(before);
  });
});

describe("phone validation stays linear on pathological input", () => {
  it("a 50k-char near-miss phone is rejected with 400 inside the time box", async () => {
    const hostile = `01${"3".repeat(50_000)}${"!".repeat(500)}`;

    const started = Date.now();
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ fullName: "ReDoS Probe", phone: hostile, password: "Test@1234", consent: true });
    const elapsed = Date.now() - started;

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
    expect(elapsed).toBeLessThan(1_000);
  });

  it("the normaliser itself handles multi-hundred-kB hostile input linearly", () => {
    const cases = [
      "0".repeat(200_000),
      `+880${"1".repeat(200_000)}`,
      `8801${"-".repeat(100_000)}2345678`,
      `০১${"৩".repeat(50_000)}`, // Bengali digits, pasted by real users
    ];

    const started = Date.now();
    for (const input of cases) {
      expect(normalizeBdPhone(input)).toBeNull();
    }
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});
