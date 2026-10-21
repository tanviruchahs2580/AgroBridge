import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { accountOrIpKey, credentialOrIpKey, userOrIpKey } from "../src/middleware/rateLimitKeys.js";

/**
 * F-03 / F-04 from the 10k-concurrency audit.
 *
 * Every limiter used to key on `req.ip`. Behind carrier-grade NAT — the normal
 * access path for this product's users — one public address fronts thousands of
 * people, so an IP-keyed quota is a quota shared with strangers. The audit
 * measured the consequence: 10 000 distinct authenticated users produced 30
 * successful AI requests and 1 063 `429`s.
 */

/** Minimal Express-Request stand-in: the key generators read only these fields. */
const asReq = (shape: Record<string, unknown>) => shape as never;

describe("rate-limit keys", () => {
  it("collapses every spelling of one account into a single login budget", () => {
    const key = (phone: string) => accountOrIpKey(asReq({ body: { phone }, ip: "1.2.3.4" }));
    const canonical = "a:01710000001";
    expect(key("01710000001")).toBe(canonical);
    expect(key("+8801710000001")).toBe(canonical);
    expect(key("8801710000001")).toBe(canonical);
    expect(key("017100 00001")).toBe(canonical);
    expect(key("০১৭১০০০০০০১")).toBe(canonical); // Bengali digits
  });

  it("falls back to the address only when no usable account is named", () => {
    expect(accountOrIpKey(asReq({ body: {}, ip: "9.9.9.9" }))).toBe("ip:9.9.9.9");
    expect(accountOrIpKey(asReq({ body: { phone: "not-a-phone" }, ip: "9.9.9.9" }))).toBe("ip:9.9.9.9");
    expect(accountOrIpKey(asReq({ ip: "9.9.9.9" }))).toBe("ip:9.9.9.9");
  });

  it("separates credentials, never stores one verbatim, and falls back to the address", () => {
    const a = credentialOrIpKey(asReq({ headers: { authorization: `Bearer ${"a".repeat(40)}` }, ip: "5.5.5.5" }));
    const b = credentialOrIpKey(asReq({ headers: { authorization: `Bearer ${"b".repeat(40)}` }, ip: "5.5.5.5" }));
    expect(a).not.toBe(b);
    expect(a.startsWith("t:")).toBe(true);
    // The limiter store must never hold a usable token.
    expect(a).not.toContain("aaaa");
    expect(credentialOrIpKey(asReq({ headers: {}, ip: "5.5.5.5" }))).toBe("ip:5.5.5.5");
    expect(credentialOrIpKey(asReq({ headers: { authorization: "Bearer short" }, ip: "5.5.5.5" }))).toBe("ip:5.5.5.5");
  });

  it("uses the authenticated principal when the request has one", () => {
    expect(userOrIpKey(asReq({ auth: { userId: "u_1" }, ip: "7.7.7.7" }))).toBe("u:u_1");
    expect(userOrIpKey(asReq({ ip: "7.7.7.7" }))).toBe("ip:7.7.7.7");
  });
});

describe("AI advisory quota is per account (F-03 regression)", () => {
  it("exhausting one account's hourly budget does not throttle another account", async () => {
    const first = await registerFarmer();
    const second = await registerFarmer();

    // Same process, same (loopback) address — exactly the NAT situation.
    let limited = false;
    for (let i = 0; i < 35 && !limited; i++) {
      const res = await request(app)
        .post("/api/v1/ai/advisory")
        .set("Authorization", `Bearer ${first.accessToken}`)
        .send({ question: `ধানের সেচ কখন দিতে হয়? (${i})`, lang: "bn" });
      if (res.status === 429) limited = true;
      else expect(res.status).toBe(200);
    }
    expect(limited, "the first account must still have its own quota").toBe(true);
    expect(first.accessToken).not.toBe(second.accessToken);

    const other = await request(app)
      .post("/api/v1/ai/advisory")
      .set("Authorization", `Bearer ${second.accessToken}`)
      .send({ question: "গমের পাতায় মরিচা ধরেছে, কী করব?", lang: "bn" });
    expect(other.status, "a second account behind the same address must be served").toBe(200);
    expect(other.body.data.answer).toBeTruthy();
  }, 30_000);
});
