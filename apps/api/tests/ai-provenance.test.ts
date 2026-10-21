import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { KB_VERSION } from "../src/providers/ai/knowledge.js";

/**
 * Provenance joins (AUD-149): a persisted advisory and its usage-log row carry
 * the KB corpus version and the request id, so a stored answer can be audited
 * against the knowledge base that produced it and correlated with server logs
 * via X-Request-Id.
 */
describe("AI answer provenance", () => {
  it("history rows and usage log carry kbVersion + requestId from the live request", async () => {
    const f = await registerFarmer();
    const ask = await request(app)
      .post("/api/v1/ai/advisory")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ question: "ধান চাষে সেচ কখন দিতে হয়?", lang: "bn" });
    expect(ask.status).toBe(200);
    const requestId = ask.body.requestId as string;
    expect(requestId).toBeTruthy();

    const history = await request(app).get("/api/v1/ai/history").set("Authorization", `Bearer ${f.accessToken}`);
    expect(history.status).toBe(200);
    expect(history.body.data.length).toBeGreaterThanOrEqual(1);
    const row = history.body.data[0] as { kbVersion: string | null; requestId: string | null; promptVersion: string | null };
    expect(row.kbVersion).toBe(KB_VERSION);
    expect(row.requestId).toBe(requestId);
    // The offline engine has no hosted prompt template.
    expect(row.promptVersion).toBeNull();

    const usage = await prisma.aiUsageLog.findFirst({
      where: { userId: f.user.id },
      orderBy: { createdAt: "desc" },
    });
    expect(usage).not.toBeNull();
    expect(usage!.requestId).toBe(requestId);
    expect(usage!.kbVersion).toBe(KB_VERSION);
  });
});
