import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * SEC-10: identity values in AuditLog metadata are stored masked. Audit rows
 * persist 180 days and are operator-readable, so the failed-login phone and
 * the EMAIL_CHANGED address land as stable masks — correlatable, never raw.
 */
describe("SEC-10 — audit metadata is masked", () => {
  it("AUTH_LOGIN_FAILED stores a masked phone, never the raw number", async () => {
    const f = await registerFarmer();
    const bad = await request(app).post("/api/v1/auth/login").send({ phone: f.phone, password: "wrong-password" });
    expect(bad.status).toBe(401);

    const row = await prisma.auditLog.findFirst({
      where: { action: "AUTH_LOGIN_FAILED", entityId: f.user.id },
      orderBy: { createdAt: "desc" },
    });
    expect(row).not.toBeNull();
    const meta = row?.metaStr ?? "";
    const masked = `${f.phone.slice(0, 3)}***${f.phone.slice(-4)}`;
    expect(meta).toContain(masked);
    expect(meta).not.toContain(f.phone); // raw normalized number never stored
    expect(JSON.parse(meta)).toMatchObject({ phone: masked, reason: "bad_password" });
  });

  it("EMAIL_CHANGED stores a masked address, never the raw one", async () => {
    const f = await registerFarmer();
    // registerFarmer sends no email; set one, then change it — the change is
    // the audited event.
    const first = await request(app)
      .patch("/api/v1/auth/me")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ email: "old.address@example.com" });
    expect(first.status).toBeLessThan(300);
    const second = await request(app)
      .patch("/api/v1/auth/me")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ email: "new.address@example.com" });
    expect(second.status).toBeLessThan(300);

    const row = await prisma.auditLog.findFirst({
      where: { action: "EMAIL_CHANGED", entityId: f.user.id },
      orderBy: { createdAt: "desc" },
    });
    expect(row).not.toBeNull();
    const meta = row?.metaStr ?? "";
    expect(meta).toContain("ne***@example.com");
    expect(meta).not.toContain("new.address@example.com");
    expect(meta).not.toContain("old.address@example.com");
  });
});
