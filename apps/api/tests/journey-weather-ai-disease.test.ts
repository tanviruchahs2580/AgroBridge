import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, createFarmWithCrop } from "./helpers.js";

/** Journey 3: weather → agricultural recommendation; Journey 4: AI Agro Agent; Journey 5: disease workflow */
describe("Journey 3 — Weather intelligence", () => {
  it("returns current weather + forecast + agri risks", async () => {
    const f = await registerFarmer();
    const res = await request(app)
      .get("/api/v1/weather?lat=25.9&lng=89.1&cropStage=VEGETATIVE")
      .set("Authorization", `Bearer ${f.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.provider).toBe("mock"); // dev/test provider clearly labelled
    expect(res.body.data.current.tempC).toBeTypeOf("number");
    expect(res.body.data.forecast.length).toBeGreaterThan(0);
    expect(res.body.data.risks.length).toBeGreaterThan(0);
    for (const r of res.body.data.risks) {
      expect(r.titleBn.length).toBeGreaterThan(0);
      expect(r.titleEn.length).toBeGreaterThan(0);
    }
  });

  it("rejects invalid coordinates", async () => {
    const f = await registerFarmer();
    const res = await request(app)
      .get("/api/v1/weather?lat=999&lng=89.1")
      .set("Authorization", `Bearer ${f.accessToken}`);
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request(app).get("/api/v1/weather?lat=25.9&lng=89.1");
    expect(res.status).toBe(401);
  });
});

describe("Journey 4 — AI Agro Agent", () => {
  it("answers grounded crop question with confidence and refs", async () => {
    const f = await registerFarmer();
    const res = await request(app)
      .post("/api/v1/ai/advisory")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ question: "ধানের পাতায় blast রোগের দাগ দেখা দিয়েছে, কী করব?", lang: "bn" });
    expect(res.status).toBe(200);
    expect(res.body.data.confidence).toBeGreaterThanOrEqual(0.7);
    expect(res.body.data.groundedRefs.length).toBeGreaterThan(0);
    expect(res.body.data.lowConfidenceFlag).toBe(false);
    // Bengali KB answer served
    expect(res.body.data.answer).toMatch(/ব্যবস্থা|ইউরিয়া|ছত্রাকনাশক|ধান/);
  });

  it("marks low-confidence answers and recommends expert verification (never fabricates)", async () => {
    const f = await registerFarmer();
    const res = await request(app)
      .post("/api/v1/ai/advisory")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ question: "আমার সাইকেলের ব্রেক ঠিক করতে চাই", lang: "bn" });
    expect(res.status).toBe(200);
    expect(res.body.data.confidence).toBeLessThan(0.55);
    expect(res.body.data.lowConfidenceFlag).toBe(true);
    expect(res.body.data.answer).toMatch(/যাচাই|কৃষি অফিসার|agronomist/i);
  });

  it("persists advisory history", async () => {
    const f = await registerFarmer();
    await request(app)
      .post("/api/v1/ai/advisory")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ question: "সরিষায় এফিড পোকা আছে", lang: "en" });
    const hist = await request(app).get("/api/v1/ai/history").set("Authorization", `Bearer ${f.accessToken}`);
    expect(hist.status).toBe(200);
    expect(hist.body.data.length).toBeGreaterThanOrEqual(1);
    expect(hist.body.data[0].confidence).toBeTypeOf("number");
  });

  it("validates question length", async () => {
    const f = await registerFarmer();
    const res = await request(app)
      .post("/api/v1/ai/advisory")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ question: "হাঁ" });
    expect(res.status).toBe(400);
  });
});

describe("Journey 5 — Disease detection workflow", () => {
  function makeJpeg(): Buffer {
    // Minimal JPEG magic bytes header + padding
    return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(1024, 7)]);
  }

  function multipartBody(boundary: string, fields: Record<string, string>, file?: { field: string; data: Buffer }) {
    const parts: Buffer[] = [];
    for (const [k, v] of Object.entries(fields)) {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    }
    if (file) {
      parts.push(
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="leaf.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`)
      );
      parts.push(file.data);
      parts.push(Buffer.from("\r\n"));
    }
    parts.push(Buffer.from(`--${boundary}--\r\n`));
    return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
  }

  it("accepts image upload and queues for expert review (no fake diagnosis)", async () => {
    const f = await registerFarmer();
    await createFarmWithCrop(f.accessToken);

    const b = multipartBody("testbound123", {}, { field: "image", data: makeJpeg() });
    const res = await request(app)
      .post("/api/v1/disease/cases")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Content-Type", b.contentType)
      .send(b.body);

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("PENDING_REVIEW");
    expect(res.body.data.diagnosis).toBeNull(); // never fabricate
    expect(res.body.data.recommendation).toMatch(/পর্যালোচনা|review/i);
  });

  it("rejects non-image content (magic byte check)", async () => {
    const f = await registerFarmer();
    const b = multipartBody("tb2", {}, { field: "image", data: Buffer.concat([Buffer.from("%PDF-1.4"), Buffer.alloc(512, 1)]) });
    const res = await request(app)
      .post("/api/v1/disease/cases")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Content-Type", b.contentType)
      .send(b.body);
    expect(res.status).toBe(400);
  });

  it("admin can review a case; farmer gets notification; status becomes REVIEWED", async () => {
    const f = await registerFarmer();
    const b = multipartBody("tb3", {}, { field: "image", data: makeJpeg() });
    const created = await request(app)
      .post("/api/v1/disease/cases")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .set("Content-Type", b.contentType)
      .send(b.body);
    const caseId = created.body.data.id as string;

    const farmerTry = await request(app)
      .post(`/api/v1/disease/cases/${caseId}/review`)
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ diagnosis: "blast", severity: "LOW", recommendation: "apply fungicide" });
    expect(farmerTry.status).toBe(403);

    const adminLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ phone: "01700000001", password: "Demo@1234" });
    const review = await request(app)
      .post(`/api/v1/disease/cases/${caseId}/review`)
      .set("Authorization", `Bearer ${adminLogin.body.data.accessToken}`)
      .send({ diagnosis: "Rice blast (early stage)", severity: "MODERATE", recommendation: "Tricyclazole spray after agronomist confirmation" });
    expect(review.status).toBe(200);
    expect(review.body.data.status).toBe("REVIEWED");

    const notifs = await request(app).get("/api/v1/notifications").set("Authorization", `Bearer ${f.accessToken}`);
    expect(notifs.body.data.items.some((n: { refId?: string }) => n.refId === caseId)).toBe(true);
  });
});
