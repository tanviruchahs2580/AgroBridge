import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";

/**
 * The per-user hourly cap on disease photo uploads (SEC-11).
 *
 * Named for the behaviour it guards, not for the round that produced it (F-92).
 */
describe("upload rate limiter (SEC-11)", () => {
  it("the 34th upload in an hour is refused with the standard envelope", async () => {
    const f = await registerFarmer();
    const auth = { Authorization: `Bearer ${f.accessToken}` };
    let limited: request.Response | null = null;
    for (let i = 0; i < 34 && !limited; i++) {
      const res = await request(app)
        .post("/api/v1/disease/cases")
        .set(auth)
        .field("cropCycleId", `cycle-${i}`)
        .attach("image", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]), {
          filename: `u${i}.jpg`,
          contentType: "image/jpeg",
        });
      if (res.status === 429) limited = res;
    }
    expect(limited, "upload limiter never fired within 34 uploads").not.toBeNull();
    expect(limited!.body.error.code).toBe("RATE_LIMITED");
    expect(typeof limited!.body.requestId).toBe("string");
  }, 60_000);
});
