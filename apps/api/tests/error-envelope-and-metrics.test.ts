import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";

/**
 * The error envelope's support reference (every 4xx names an AB- code) and the
 * metrics endpoint's exposure policy.
 *
 * Named for the behaviour it guards, not for the round that produced it (F-92).
 */
describe("error envelope references", () => {
  it("route-level 404 carries an AB-reference support code", async () => {
    const res = await request(app).get("/api/v1/definitely-not-a-route");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ROUTE_NOT_FOUND");
    expect(res.body.error.reference).toMatch(/^AB-[0-9A-F]{6}$/);
  });

  it("AppError 4xx envelopes carry an AB-reference (401 login + 422 validation)", async () => {
    const unauthorized = await request(app).post("/api/v1/auth/login").send({ phone: "01700000000", password: "Wrong@Pass1" });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.body.error.reference).toMatch(/^AB-[0-9A-F]{6}$/);

    const f = await registerFarmer();
    const badWithdrawal = await request(app)
      .post("/api/v1/wallet/withdrawals")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ amountPaisa: -5 });
    expect(badWithdrawal.status).toBe(400);
    expect(badWithdrawal.body.error.reference).toMatch(/^AB-[0-9A-F]{6}$/);

    // References are unique per error occurrence (support correlation aid).
    const again = await request(app).post("/api/v1/auth/login").send({ phone: "01700000000", password: "Wrong@Pass1" });
    expect(again.body.error.reference).not.toBe(unauthorized.body.error.reference);
  });
});

describe("metrics exposure", () => {
  it("/metrics is reachable without a token outside production", async () => {
    // Guard short-circuits on !isProd, so neither a private source nor a
    // METRICS_TOKEN bearer is required in dev/test environments.
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.text).toContain("agrobridge_http_requests_total");
    expect(res.text).toContain("agrobridge_db_up");
  });
});
