import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, createUserWithRole } from "./helpers.js";

describe("Tenant isolation — Organization", () => {
  it("CORPORATE user cannot see another org's farm", async () => {
    const corpA = await createUserWithRole("CORPORATE");
    const corpB = await createUserWithRole("CORPORATE");
    // Create orgs
    const orgA = await request(app).post("/api/v1/organizations").set("Authorization", `Bearer ${corpA.accessToken}`).send({ name: "Org-A", type: "CORPORATE", district: "Dhaka" });
    expect(orgA.status).toBe(201);
    const orgB = await request(app).post("/api/v1/organizations").set("Authorization", `Bearer ${corpB.accessToken}`).send({ name: "Org-B", type: "CORPORATE" });
    expect(orgB.status).toBe(201);
    // CorpA creates farm in Org-A
    const farmA = await request(app).post("/api/v1/farms").set("Authorization", `Bearer ${corpA.accessToken}`).send({ name: "Farm-A", district: "Dhaka", organizationId: orgA.body.data.id });
    expect(farmA.status).toBe(201);
    // CorpB lists farms — should NOT see Farm-A
    const listB = await request(app).get("/api/v1/farms").set("Authorization", `Bearer ${corpB.accessToken}`);
    expect(listB.status).toBe(200);
    const idsB = (listB.body.data as { id: string }[]).map((f) => f.id);
    expect(idsB).not.toContain(farmA.body.data.id);
    // CorpB tries to fetch Farm-A directly → 403 or 404 (not your farm)
    const peek = await request(app).get(`/api/v1/farms/${farmA.body.data.id}/plots`).set("Authorization", `Bearer ${corpB.accessToken}`);
    expect([403, 404]).toContain(peek.status);
    // CorpA can see own org farm via org farms endpoint
    const orgFarms = await request(app).get(`/api/v1/organizations/${orgA.body.data.id}/farms`).set("Authorization", `Bearer ${corpA.accessToken}`);
    expect(orgFarms.status).toBe(200);
    expect((orgFarms.body.data as unknown[]).length).toBeGreaterThan(0);
    // CorpB cannot list Org-A farms
    const forbidden = await request(app).get(`/api/v1/organizations/${orgA.body.data.id}/farms`).set("Authorization", `Bearer ${corpB.accessToken}`);
    expect(forbidden.status).toBe(403);
  });

  it("FARMER cannot create org-farm without membership", async () => {
    const farmer = await registerFarmer();
    const corp = await createUserWithRole("CORPORATE");
    const org = await request(app).post("/api/v1/organizations").set("Authorization", `Bearer ${corp.accessToken}`).send({ name: "Org-C", type: "COOPERATIVE" });
    expect(org.status).toBe(201);
    const attempt = await request(app).post("/api/v1/farms").set("Authorization", `Bearer ${farmer.accessToken}`).send({ name: "Hijack Farm", organizationId: org.body.data.id });
    expect(attempt.status).toBe(403);
  });
});
