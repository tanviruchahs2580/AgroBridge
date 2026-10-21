import { describe, expect, it } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { app, uniquePhone } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { POLICY_VERSION } from "../src/modules/auth/routes.js";

/**
 * PRD-05 / AUD-150: registration must capture consent to the published Terms +
 * Privacy Policy. The API requires `consent: true` (a client that omits it
 * gets 400 BAD_REQUEST — intended, older clients are refused) and records a
 * CONSENT_CAPTURED audit row carrying the accepted policy version.
 */
describe("registration consent capture (PRD-05/AUD-150)", () => {
  it("refuses registration without the consent field (400 BAD_REQUEST) and creates nothing", async () => {
    const phone = uniquePhone();
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ fullName: "No Consent", phone, password: "Test@1234" });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe("BAD_REQUEST");
    expect(await prisma.user.count({ where: { phone } })).toBe(0);
  });

  it("refuses consent:false — only the literal true is accepted", async () => {
    const phone = uniquePhone();
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ fullName: "Falsy Consent", phone, password: "Test@1234", consent: false });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
    expect(await prisma.user.count({ where: { phone } })).toBe(0);
  });

  it("registers with consent:true and writes the CONSENT_CAPTURED audit row with the policy version", async () => {
    const phone = uniquePhone();
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ fullName: "Consenting Farmer", phone, password: "Test@1234", consent: true });
    expect(res.status).toBe(201);

    const userId = res.body.data.user.id as string;
    const rows = await prisma.auditLog.findMany({
      where: { actorId: userId, action: "CONSENT_CAPTURED" },
      orderBy: { createdAt: "desc" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].entityType).toBe("User");
    expect(rows[0].entityId).toBe(userId);
    const meta = JSON.parse(rows[0].metaStr ?? "{}") as { policyVersion?: string; scope?: string };
    expect(meta.policyVersion).toBe(POLICY_VERSION);
    expect(meta.scope).toBe("terms+privacy");
  });

  it("the recorded policy version tracks the published web legal document version", () => {
    // The web app owns the documents (apps/web/src/features/legal/content.ts);
    // this pins the two together so a document bump that forgets the API
    // constant fails here instead of silently mis-recording consent.
    const content = readFileSync(new URL("../../../apps/web/src/features/legal/content.ts", import.meta.url), "utf8");
    const version = /^const VERSION = "([^"]+)";/m.exec(content)?.[1];
    expect(version).toBeTruthy();
    expect(POLICY_VERSION).toBe(version);
  });
});
