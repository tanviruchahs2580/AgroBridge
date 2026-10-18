import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { liveGroundedRefs } from "../src/modules/aiagent/routes.js";

/**
 * Advisory history must not serve references to KB entries that were removed
 * after the answer was persisted (AUD-110b / A2-04 / E-1007). Refs are resolved
 * against the CURRENT KB at read time; dead ids are dropped rather than
 * presented as live citations.
 */
describe("GET /ai/history — live KB refs only", () => {
  it("drops refs to non-existent KB entries and keeps live ones", async () => {
    const farmer = await registerFarmer();
    const auth = { Authorization: `Bearer ${farmer.accessToken}` };

    const live = await request(app)
      .post("/api/v1/ai/advisory")
      .set(auth)
      .send({ question: "ধানের সেচ কখন দিতে হয়?", lang: "bn" });
    expect(live.status).toBe(200);
    expect(live.body.data.groundedRefs).toContain("irrigation-general");

    // Simulate a row persisted before a KB entry was deleted: one live ref,
    // one removed id (and a duplicate to prove order-preserving de-dup).
    await prisma.advisoryQuery.create({
      data: {
        userId: farmer.user.id,
        question: "stored question with a removed source",
        answer: "stored answer",
        confidence: 0.8,
        provider: "offline-agro-engine",
        model: "kb-retrieval-v1",
        lowConfidenceFlag: false,
        groundedRefs: JSON.stringify(["rice-blast", "kb-entry-removed-2026", "rice-blast", "also-removed"]),
      },
    });

    const res = await request(app).get("/api/v1/ai/history").set(auth);
    expect(res.status).toBe(200);
    const rows = res.body.data as { question: string; groundedRefs: string[] }[];

    const stored = rows.find((r) => r.question === "stored question with a removed source");
    expect(stored, "stored row must be served").toBeTruthy();
    expect(stored!.groundedRefs).toEqual(["rice-blast"]);
    // Nothing anywhere in the payload may reveal the removed ids as citations.
    expect(JSON.stringify(res.body)).not.toContain("kb-entry-removed-2026");
    expect(JSON.stringify(res.body)).not.toContain("also-removed");

    const liveRow = rows.find((r) => r.question === "ধানের সেচ কখন দিতে হয়?");
    expect(liveRow!.groundedRefs).toContain("irrigation-general");
  });

  it("liveGroundedRefs tolerates malformed stored values", () => {
    expect(liveGroundedRefs(null)).toEqual([]);
    expect(liveGroundedRefs("")).toEqual([]);
    expect(liveGroundedRefs("not json at all")).toEqual([]);
    expect(liveGroundedRefs(JSON.stringify({ ref: "rice-blast" }))).toEqual([]);
    expect(liveGroundedRefs(JSON.stringify(["nope", "rice-urea", 42, "rice-urea"]))).toEqual(["rice-urea"]);
  });
});
