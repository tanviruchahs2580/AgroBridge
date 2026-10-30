import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import {
  KNOWLEDGE_BASE,
  KB_VERSION,
  kbVersionOf,
  type KbEntry,
  type KbSourceRef,
} from "../src/providers/ai/knowledge.js";
import { OfflineAgroEngine } from "../src/providers/ai/offline-engine.js";
import { containsAgrochemGuidance, unreviewedTreatmentNote } from "../src/providers/ai/types.js";
import { liveGroundedRefs, liveGroundedSources } from "../src/modules/aiagent/routes.js";

/**
 * A3-01 — citations resolve to the exact retrieved chunk and carry useful,
 * truthful metadata; no fake citations, no URLs that do not exist.
 *
 * A4-09 — agrochemical guidance is either source-reviewed or explicitly
 * flagged as unverified; an unreviewed corpus entry that names or doses an
 * input must never be served as if it were reviewed.
 */

async function ask(token: string, question: string, lang: "bn" | "en" = "bn") {
  return request(app)
    .post("/api/v1/ai/advisory")
    .set("Authorization", `Bearer ${token}`)
    .send({ question, lang });
}

describe("A3-01 — grounded citations resolve to the live corpus", () => {
  it("an answer carries source metadata in ref order, resolved from the live KB", async () => {
    const f = await registerFarmer();
    const res = await ask(f.accessToken, "ধানে ইউরিয়া সার কখন দিতে হয়?");
    expect(res.status).toBe(200);

    const data = res.body.data as { groundedRefs: string[]; groundedSources: KbSourceRef[]; kbVersion: string };
    expect(data.groundedRefs.length).toBeGreaterThan(0);
    expect(data.groundedSources.length).toBe(data.groundedRefs.length);
    expect(data.groundedSources.map((s) => s.id)).toEqual(data.groundedRefs);

    const byId = new Map(KNOWLEDGE_BASE.map((e) => [e.id, e]));
    for (const s of data.groundedSources) {
      const entry = byId.get(s.id);
      // Resolves to a real chunk, not a name invented at response time.
      expect(entry, `${s.id} is not in the live corpus`).toBeDefined();
      if (!entry) throw new Error(`${s.id} missing from the live corpus`);
      expect(s.titleEn).toBe(entry.titleEn);
      expect(s.titleBn).toBe(entry.titleBn);
      expect(s.crop).toBe(entry.crop);
      expect(s.status).toBe(entry.status);
      expect(s.titleEn.trim()).not.toBe("");
    }
    // The version answers were grounded in is the live one.
    expect(data.kbVersion).toBe(KB_VERSION);
    // A Bengali answer names its source in Bengali — the trailing title line is
    // not an English leak into a bn transcript.
    const answer = res.body.data.answer as string;
    expect(answer).toContain("— ধানে ইউরিয়া প্রয়োগের সময়সূচি");
    expect(answer).not.toContain("— Urea application schedule for rice");
    // No fabricated URLs anywhere in the citation payload — an unrecorded
    // source cannot become a link.
    expect(JSON.stringify(data.groundedSources)).not.toMatch(/https?:\/\//);
  });

  it("an English answer keeps the English corpus title", async () => {
    const f = await registerFarmer();
    const res = await ask(f.accessToken, "When should I apply urea to rice?", "en");
    expect(res.status).toBe(200);
    expect(res.body.data.answer as string).toContain("— Urea application schedule for rice");
    expect(res.body.data.answer as string).not.toContain("— ধানে ইউরিয়া প্রয়োগের সময়সূচি");
  });

  it("history rows resolve their stored ids against the live corpus too", async () => {
    const f = await registerFarmer();
    await ask(f.accessToken, "পাটের কাণ্ড পচে যাচ্ছে, কী করব?");
    const history = await request(app).get("/api/v1/ai/history").set("Authorization", `Bearer ${f.accessToken}`);
    expect(history.status).toBe(200);
    const row = history.body.data[0] as { groundedRefs: string[]; groundedSources: KbSourceRef[] };
    expect(row.groundedRefs).toContain("jute-stem-rot");
    expect(row.groundedSources.map((s) => s.id)).toEqual(row.groundedRefs);
    expect(row.groundedSources[0]?.titleEn).toBe("Jute stem rot & yellowing");
  });

  it("ids removed from the corpus resolve to nothing — never to a guessed title", () => {
    expect(liveGroundedSources(["rice-urea", "no-such-entry"])).toEqual([
      liveGroundedSources(["rice-urea"])[0],
    ]);
    expect(liveGroundedRefs(JSON.stringify(["rice-urea", "no-such-entry"]))).toEqual(["rice-urea"]);
    expect(liveGroundedRefs('{"not":"an array"}')).toEqual([]);
    expect(liveGroundedRefs(null)).toEqual([]);
  });
});

describe("A4-09 — agrochemical guidance is grounded or explicitly flagged unverified", () => {
  it("the detector recognises named inputs and doses in both languages", () => {
    for (const t of [
      "Apply 50 kg urea per bigha",
      "spray 2 ml per litre of water",
      "প্রতি বিঘায় ৫০ কেজি ইউরিয়া দিন",
      "ছত্রাকনাশক স্প্রে করুন",
      "use a copper fungicide every 10 days",
    ]) {
      expect(containsAgrochemGuidance(t), t).toBe(true);
    }
    for (const t of [
      "Irrigate early morning or evening.",
      "Keep the field drained for a week.",
      "মাটি পরীক্ষা করান উপজেলা অফিসে।",
      "plant spacing of 20 cm between rows",
    ]) {
      expect(containsAgrochemGuidance(t), t).toBe(false);
    }
  });

  it("an UNSOURCED entry that doses an input is served WITH the review-pending note", async () => {
    const f = await registerFarmer();
    const res = await ask(f.accessToken, "ধানে ইউরিয়া কতবার দেব?");
    expect(res.status).toBe(200);
    expect(res.body.data.groundedRefs).toContain("rice-urea");
    // UNSOURCED + chemical guidance → the flag is present regardless of the
    // (high) heuristic confidence band.
    expect(res.body.data.lowConfidenceFlag).toBe(false);
    expect(res.body.data.answer).toContain("অভ্যন্তরীণ তথ্যভাণ্ডার");
    expect(res.body.data.answer).toContain(unreviewedTreatmentNote("bn").slice(4, 30));
  });

  it("a non-input answer does not wear the note", async () => {
    const f = await registerFarmer();
    // jute-stem-rot's guidance is cultural (drainage, rotation) — no named
    // input, no dose — so the review-pending note does not belong there.
    const res = await ask(f.accessToken, "পাটের কাণ্ড পচে যাচ্ছে");
    expect(res.status).toBe(200);
    expect(res.body.data.groundedRefs).toContain("jute-stem-rot");
    expect(res.body.data.answer).not.toContain("অভ্যন্তরীণ তথ্যভাণ্ডার");
  });

  it("a REVIEWED entry with recorded provenance is served without the note — the note tracks provenance, not topic", async () => {
    const reviewed: KbEntry[] = [
      {
        id: "test-urea-reviewed",
        crop: "rice",
        keywords: ["urea", "ইউরিয়া"],
        titleEn: "Reviewed urea guidance (fixture)",
        answerEn: "Apply 50 kg urea per acre in three splits.",
        answerBn: "একরে ৫০ কেজি ইউরিয়া তিন কিস্তিতে দিন।",
        confidence: 0.9,
        sourceName: "Fixture agricultural manual",
        sourceUrl: "https://example.test/manual",
        reviewedAt: "2026-01-15",
        status: "REVIEWED",
      },
    ];
    const engine = new OfflineAgroEngine({ corpus: reviewed });

    const en = await engine.ask("urea schedule", { lang: "en" });
    expect(en.answer).toContain("50 kg urea");
    expect(en.answer).not.toContain("not yet agronomist-reviewed");
    expect(en.groundedSources?.[0]).toMatchObject({ id: "test-urea-reviewed", status: "REVIEWED" });

    // Same content, provenance stripped → the note appears and the corpus
    // version differs from the production KB (no answer can masquerade as
    // grounded in the reviewed corpus).
    const unsourced = reviewed.map((e) => ({ ...e, status: "UNSOURCED" as const, sourceName: null, sourceUrl: null, reviewedAt: null }));
    const engine2 = new OfflineAgroEngine({ corpus: unsourced });
    const bn = await engine2.ask("ইউরিয়া কখন দেব?", { lang: "bn" });
    expect(bn.answer).toContain("বিশেষজ্ঞ-যাচাইকৃত নয়");
    expect(bn.kbVersion).not.toBe(KB_VERSION);
    expect(bn.kbVersion).toBe(kbVersionOf(unsourced));
  });
});
