import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, uniquePhone } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * Registration is not an account-existence oracle (AUD-142b).
 *
 * Re-registering a phone returns the same 200 shape a fresh registration's
 * guidance step would (nothing is created); the explicit 409 remains only for
 * an email collision, which is a different disclosure surface.
 */
describe("registration enumeration resistance", () => {
  it("duplicate phone returns a neutral 200 and creates nothing", async () => {
    const phone = uniquePhone();
    const first = await request(app)
      .post("/api/v1/auth/register")
      .send({ fullName: "First Owner", phone, password: "Test@1234", langPref: "bn", consent: true });
    expect(first.status).toBe(201);
    expect(first.body.data.accessToken).toBeDefined();

    const second = await request(app)
      .post("/api/v1/auth/register")
      .send({ fullName: "Second Attempt", phone, password: "Other@1234", langPref: "bn", consent: true });
    expect(second.status).toBe(200);
    expect(second.body.data.needsLogin).toBe(true);
    expect(second.body.data.accessToken).toBeUndefined();

    const rows = await prisma.user.count({ where: { phone } });
    expect(rows).toBe(1);
    // The original account is untouched by the second attempt.
    const login = await request(app).post("/api/v1/auth/login").send({ phone, password: "Test@1234" });
    expect(login.status).toBe(200);
  });

  it("an email collision still returns an explicit 409", async () => {
    const email = `dup-${Date.now()}@example.com`;
    const first = await request(app)
      .post("/api/v1/auth/register")
      .send({ fullName: "Email Owner", phone: uniquePhone(), email, password: "Test@1234", langPref: "bn", consent: true });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/v1/auth/register")
      .send({ fullName: "Email Thief", phone: uniquePhone(), email, password: "Test@1234", langPref: "bn", consent: true });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("CONFLICT");
  });
});
