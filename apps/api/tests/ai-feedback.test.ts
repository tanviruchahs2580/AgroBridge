import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";

/**
 * Advisory feedback (A7-07): POST /ai/history/:id/feedback lets the caller
 * report why an answer was not useful. The row must belong to the caller (404
 * otherwise — no existence oracle), the reason is validated to 3..500 chars,
 * a second report overwrites the first (a farmer may refine), and every write
 * is audited. GET /ai/history exposes `feedbackReason`/`feedbackAt`.
 */

async function seedAdvisory(accessToken: string, question: string): Promise<string> {
  const ask = await request(app)
    .post("/api/v1/ai/advisory")
    .set("Authorization", `Bearer ${accessToken}`)
    .send({ question, lang: "bn" });
  expect(ask.status).toBe(200);
  const hist = await request(app).get("/api/v1/ai/history").set("Authorization", `Bearer ${accessToken}`);
  const row = (hist.body.data as { id: string; question: string }[]).find((r) => r.question === question);
  expect(row, "persisted advisory row must be visible in history").toBeTruthy();
  return row!.id;
}

describe("POST /ai/history/:id/feedback", () => {
  it("own row: stores reason/at, exposes them in history, and audits the write", async () => {
    const f = await registerFarmer();
    const auth = { Authorization: `Bearer ${f.accessToken}` };
    const question = `পাতায় দাগ কেন দেখাচ্ছে? ${Date.now()}`;
    const id = await seedAdvisory(f.accessToken, question);

    const reason = "উত্তরটি আমার ফসলের জন্য প্রযোজ্য নয়";
    const res = await request(app).post(`/api/v1/ai/history/${id}/feedback`).set(auth).send({ reason });
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(id);
    expect(res.body.data.feedbackReason).toBe(reason);
    expect(Number.isNaN(new Date(res.body.data.feedbackAt).getTime())).toBe(false);

    const hist = await request(app).get("/api/v1/ai/history").set(auth);
    const row = (hist.body.data as { id: string; feedbackReason: string | null; feedbackAt: string | null }[]).find((r) => r.id === id);
    expect(row!.feedbackReason).toBe(reason);
    expect(row!.feedbackAt).toBe(res.body.data.feedbackAt);

    const logged = await prisma.auditLog.findFirst({ where: { action: "AI_ADVISORY_FEEDBACK", entityId: id } });
    expect(logged).toBeTruthy();
    expect(logged!.actorId).toBe(f.user.id);
    expect(logged!.entityType).toBe("AdvisoryQuery");
  });

  it("another user's row: 404 and nothing is written", async () => {
    const a = await registerFarmer();
    const b = await registerFarmer();
    const id = await seedAdvisory(a.accessToken, `ধানের রোগ কী? ${Date.now()}`);

    const res = await request(app)
      .post(`/api/v1/ai/history/${id}/feedback`)
      .set("Authorization", `Bearer ${b.accessToken}`)
      .send({ reason: "answer was irrelevant" });
    expect(res.status).toBe(404);

    const stored = await prisma.advisoryQuery.findUnique({ where: { id } });
    expect(stored!.feedbackReason).toBeNull();
    expect(stored!.feedbackAt).toBeNull();
  });

  it("unknown id: 404", async () => {
    const f = await registerFarmer();
    const res = await request(app)
      .post("/api/v1/ai/history/does-not-exist-id/feedback")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ reason: "not useful at all" });
    expect(res.status).toBe(404);
  });

  it("validation: reason must be 3..500 chars after trimming (both ends accepted)", async () => {
    const f = await registerFarmer();
    const auth = { Authorization: `Bearer ${f.accessToken}` };
    const id = await seedAdvisory(f.accessToken, `সেচ কতটুকু? ${Date.now()}`);

    for (const bad of ["ab", "   ", "a".repeat(501)]) {
      const res = await request(app).post(`/api/v1/ai/history/${id}/feedback`).set(auth).send({ reason: bad });
      expect(res.status, `reason ${JSON.stringify(bad).slice(0, 20)} must be rejected`).toBe(400);
    }

    const min = await request(app).post(`/api/v1/ai/history/${id}/feedback`).set(auth).send({ reason: "abc" });
    expect(min.status).toBe(200);
    const max = await request(app).post(`/api/v1/ai/history/${id}/feedback`).set(auth).send({ reason: "b".repeat(500) });
    expect(max.status).toBe(200);
  });

  it("a second report overwrites the first (farmers may refine) and advances the timestamp", async () => {
    const f = await registerFarmer();
    const auth = { Authorization: `Bearer ${f.accessToken}` };
    const id = await seedAdvisory(f.accessToken, `ইউরিয়া কখন? ${Date.now()}`);

    const first = await request(app).post(`/api/v1/ai/history/${id}/feedback`).set(auth).send({ reason: "not clear in Bangla" });
    expect(first.status).toBe(200);
    await new Promise((r) => setTimeout(r, 25));
    const second = await request(app).post(`/api/v1/ai/history/${id}/feedback`).set(auth).send({ reason: "wrong crop for my field" });
    expect(second.status).toBe(200);

    expect(second.body.data.feedbackReason).toBe("wrong crop for my field");
    expect(new Date(second.body.data.feedbackAt).getTime()).toBeGreaterThan(new Date(first.body.data.feedbackAt).getTime());

    // Still exactly one row for this advisory, carrying only the latest report.
    const hist = await request(app).get("/api/v1/ai/history").set(auth);
    expect((hist.body.data as { id: string }[]).filter((r) => r.id === id)).toHaveLength(1);
  });

  /**
   * Runs LAST in this file: it deliberately exhausts the per-IP hourly AI
   * advisory limiter (30/h, same approach as security-matrix.test.ts). Every
   * advisory call after this point in the file would be throttled.
   */
  it("429 from the AI limiter carries the standard envelope with the request id", async () => {
    const f = await registerFarmer();
    let limited = false;
    let body: unknown;
    let headerId: string | undefined;
    for (let i = 0; i < 35; i++) {
      const r = await request(app)
        .post("/api/v1/ai/advisory")
        .set("Authorization", `Bearer ${f.accessToken}`)
        .send({ question: `সেচ কখন দিতে হয়? (${i})`, lang: "bn" });
      if (r.status === 429) {
        limited = true;
        body = r.body;
        headerId = r.headers["x-request-id"] as string | undefined;
        break;
      }
      expect(r.status).toBe(200);
    }
    expect(limited, "the hourly AI advisory limiter must trip within 35 attempts").toBe(true);

    const b = body as { ok: boolean; error: { code: string; message: string }; requestId?: string };
    expect(b.ok).toBe(false);
    expect(b.error.code).toBe("RATE_LIMITED");
    expect(b.error.message).toContain("AI advisory limit"); // limiter's own copy preserved
    expect(b.requestId).toBeTruthy();
    expect(b.requestId).toBe(headerId); // correlatable, like every other error
  });
});
