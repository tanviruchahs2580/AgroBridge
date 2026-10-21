import { beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import request from "supertest";
import { app, registerFarmer, getAdmin } from "./helpers.js";
import { verifyPasswordAgainst, storedHashIsCheaper } from "../src/modules/auth/password.js";
import { bcryptCost } from "../src/modules/auth/bcryptPool.js";
import { prisma } from "../src/lib/prisma.js";
import { env } from "../src/config/env.js";

/**
 * Two changes this spec pins, both of which touch code whose job is to be
 * boring and correct on every single request:
 *
 * 1. `requireAuth` reads the caller's row by raw SQL (F-05 remainder). The read is
 *    the same table at the same instant as the `findUnique` it replaced — only the
 *    cost changed (measured 1.23 ms vs 3.03 ms mean, 0.73 vs 1.84 ms CPU) — so
 *    these specs pin the *semantics* that must survive it: the role comes from the
 *    database rather than the token, an unknown subject is rejected, and
 *    suspension still cuts an account off on the next request.
 *
 * 2. The transparent password-cost upgrade on login (F-02 option c). Its decision
 *    logic is pure and fully unit-tested; the integration assertion here is the
 *    one that protects against a real regression, namely rewriting the stored
 *    hash on every login when no upgrade is needed.
 */

let admin: Awaited<ReturnType<typeof getAdmin>>;

beforeAll(async () => {
  admin = await getAdmin();
});

function tokenFor(userId: string, role: string): string {
  // Same signer parameters the API uses; only the claims differ deliberately.
  return jwt.sign({ sub: userId, role }, env.JWT_ACCESS_SECRET, {
    expiresIn: "6h",
    issuer: "agrobridge",
    algorithm: "HS256",
  });
}

describe("auth hot path — semantics that must survive the raw SQL change", () => {
  it("takes the role from the database, never from the token", async () => {
    const f = await registerFarmer();
    const forged = tokenFor(f.user.id, "SUPER_ADMIN");

    const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${forged}`);
    expect(me.status).toBe(200);
    expect(me.body.data.role).toBe("FARMER");

    // The same reason `req.auth.role` is DB-sourced: a minted claim must not
    // grant permissions the account does not hold.
    const adminRoute = await request(app).get("/api/v1/admin/users").set("Authorization", `Bearer ${forged}`);
    expect(adminRoute.status).toBe(403);
  });

  it("rejects a token whose subject has no row (raw query returns no row)", async () => {
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${tokenFor("qa_no_such_user_0001", "FARMER")}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  it("still cuts a suspended account off on its very next request", async () => {
    const f = await registerFarmer();
    const before = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${f.accessToken}`);
    expect(before.status).toBe(200);

    const suspended = await request(app)
      .patch(`/api/v1/admin/users/${f.user.id}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ status: "SUSPENDED" });
    expect(suspended.status).toBe(200);

    const after = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${f.accessToken}`);
    expect(after.status).toBe(401);
  });
});

describe("transparent password-cost upgrade on login", () => {
  it("stores hashes at the configured cost and reports that cost", () => {
    expect(bcryptCost()).toBe(4); // the test profile; production serves at 12
    expect(bcrypt.hashSync("x", bcryptCost()).startsWith(`$2a$0${bcryptCost()}$`)).toBe(true);
  });

  it("the stored hash is byte-identical after a login that needs no upgrade", async () => {
    const f = await registerFarmer();
    const storedBefore = (await prisma.user.findUnique({ where: { id: f.user.id }, select: { passwordHash: true } }))!.passwordHash;
    expect(storedHashIsCheaper(storedBefore, bcryptCost())).toBe(false);

    const login = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: f.plainPassword });
    expect(login.status).toBe(200);

    const storedAfter = (await prisma.user.findUnique({ where: { id: f.user.id }, select: { passwordHash: true } }))!.passwordHash;
    expect(storedAfter).toBe(storedBefore);
  });

  it("verifyPasswordAgainst still returns false for an account that does not exist", async () => {
    expect(await verifyPasswordAgainst(null, "whatever")).toBe(false);
    expect(await verifyPasswordAgainst(bcrypt.hashSync("x", bcryptCost()), "wrong")).toBe(false);
  });
});

describe("storedHashIsCheaper (pure decision)", () => {
  it("answers for every factor relative to the configured one", () => {
    // 4 is the configured cost in the test profile; production is 12.
    expect(storedHashIsCheaper("$2a$04$" + "s".repeat(53), 4)).toBe(false); // equal
    expect(storedHashIsCheaper("$2a$12$" + "s".repeat(53), 4)).toBe(false); // higher: must never be "upgraded" to a weaker one
    expect(storedHashIsCheaper("$2a$04$" + "s".repeat(53), 12)).toBe(true); // production configured 12
  });

  it("recognises every bcrypt identifier variant and rejects a malformed hash", () => {
    for (const variant of ["$2a$03$", "$2b$05$", "$2x$07$", "$2y$09$"]) {
      expect(storedHashIsCheaper(variant + "s".repeat(53), 10)).toBe(true);
    }
    expect(storedHashIsCheaper("not-a-bcrypt-hash", 12)).toBe(false);
    expect(storedHashIsCheaper("$2a$xx$abcdefghijklmnop", 12)).toBe(false);
    // Truncated/oversized cost digits must not parse as a lower cost.
    expect(storedHashIsCheaper("$2a$1$" + "s".repeat(53), 12)).toBe(false);
  });

  it("never reports an upgraded-(stronger) hash as cheaper", () => {
    expect(storedHashIsCheaper("$2a$31$" + "s".repeat(53), 12)).toBe(false);
  });
});
