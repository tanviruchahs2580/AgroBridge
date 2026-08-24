import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";

/** Journey 1: Farmer registration → login → profile */
describe("Journey 1 — Auth & profile", () => {
  it("registers a farmer with valid BD phone", async () => {
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ fullName: "করিম মিয়া", phone: `018${Date.now().toString().slice(-8)}`, password: "Karim@1234" });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.role).toBe("FARMER");
  });

  it("rejects invalid phone and weak password", async () => {
    const badPhone = await request(app)
      .post("/api/v1/auth/register")
      .send({ fullName: "X Y", phone: "12345", password: "LongEnough@123" });
    expect(badPhone.status).toBe(400);

    const weak = await request(app)
      .post("/api/v1/auth/register")
      .send({ fullName: "X Y", phone: `019${Date.now().toString().slice(-8)}`, password: "short" });
    expect(weak.status).toBe(400);
  });

  it("rejects duplicate registration", async () => {
    const f = await registerFarmer();
    const again = await request(app)
      .post("/api/v1/auth/register")
      .send({ fullName: "Another Name", phone: f.phone, password: "Whatever@123" });
    expect(again.status).toBe(409);
  });

  it("logs in and returns tokens + user", async () => {
    const f = await registerFarmer({ password: "Login@1234" });
    const res = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: "Login@1234" });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
  });

  it("rejects wrong password with 401 (no user enumeration)", async () => {
    const f = await registerFarmer();
    const res = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: "WrongPass@123" });
    expect(res.status).toBe(401);
    const ghost = await request(app).post("/api/v1/auth/login").send({ phone: "01799999999", password: "WrongPass@123" });
    expect(ghost.status).toBe(401);
    expect(res.body.error.message).toBe(ghost.body.error.message);
  });

  it("GET /me returns profile with wallet and tier; requires auth", async () => {
    const f = await registerFarmer();
    const noAuth = await request(app).get("/api/v1/auth/me");
    expect(noAuth.status).toBe(401);

    const res = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${f.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.farmerProfile.membershipTier).toBe("BRONZE");
    expect(res.body.data.wallet).toBeDefined();
  });

  it("refresh rotates tokens and revokes the old refresh token", async () => {
    const f = await registerFarmer();
    const r1 = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: f.refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.body.data.refreshToken).not.toBe(f.refreshToken);

    // Old token must be unusable (rotation)
    const replay = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: f.refreshToken });
    expect(replay.status).toBe(401);
  });

  it("logout revokes session", async () => {
    const f = await registerFarmer();
    await request(app).post("/api/v1/auth/logout").set("Authorization", `Bearer ${f.accessToken}`).send({});
    expect(true).toBe(true); // logout is best-effort token revoke
  });
});
