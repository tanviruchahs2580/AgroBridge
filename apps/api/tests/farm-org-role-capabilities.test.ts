import { describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, createUserWithRole } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { ORG_MEMBER_CAPABILITIES } from "../src/modules/farms/routes.js";

/**
 * F-06 (P1): the organisation membership role must decide what a member may do
 * with an org farm. Before this suite the string `VIEWER` appeared nowhere in
 * `apps/api/tests`, and `assertFarmAccess` never read `member.role` — so the
 * read-only role could rename or DELETE another member's farm, cascading away
 * its plots, crop cycles and digital record.
 *
 * The invite contract is `role: z.enum(["ADMIN","MEMBER","VIEWER"])` in
 * `organizations/routes.ts`; these tests drive that contract over HTTP rather
 * than inserting membership rows directly, so a change to the invite surface
 * cannot silently invalidate the assumption.
 */

/** A CORPORATE owner with an org, and one org farm owned by that account. */
async function orgWithFarm() {
  const owner = await createUserWithRole("CORPORATE");
  const orgRes = await request(app)
    .post("/api/v1/organizations")
    .set("Authorization", `Bearer ${owner.accessToken}`)
    .send({ name: `Cap Org ${Date.now()}`, type: "COOPERATIVE" });
  expect(orgRes.status).toBe(201);
  const orgId = orgRes.body.data.id as string;

  const farmRes = await request(app)
    .post("/api/v1/farms")
    .set("Authorization", `Bearer ${owner.accessToken}`)
    .send({ name: "Org Farm", district: "Rangpur", lat: 25.9, lng: 89.1, totalAreaBigha: 5, organizationId: orgId });
  expect(farmRes.status).toBe(201);
  const farmId = farmRes.body.data.id as string;

  /** Invite a buyer as `role` in the org (through the real invite endpoint). */
  async function invite(role: "ADMIN" | "MEMBER" | "VIEWER") {
    const user = await createUserWithRole("FARMER");
    const res = await request(app)
      .post(`/api/v1/organizations/${orgId}/members`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ userId: user.userId, role });
    expect(res.status).toBe(201);
    expect(res.body.data.role).toBe(role);
    return user;
  }

  return { owner, orgId, farmId, invite };
}

describe("F-06: organisation membership role decides farm capability", () => {
  it("the capability table is the policy: VIEWER read-only, MEMBER write, ADMIN destructive", () => {
    expect(ORG_MEMBER_CAPABILITIES.VIEWER).toEqual(["read"]);
    expect(ORG_MEMBER_CAPABILITIES.MEMBER).toContain("write");
    expect(ORG_MEMBER_CAPABILITIES.MEMBER).not.toContain("delete");
    expect(ORG_MEMBER_CAPABILITIES.ADMIN).toEqual(["read", "write", "delete"]);
  });

  it("an org VIEWER cannot rename the farm (PATCH → 404, farm unchanged)", async () => {
    const { owner, farmId, invite } = await orgWithFarm();
    const viewer = await invite("VIEWER");

    // The read half still works: a VIEWER is a member, so reads are allowed.
    const read = await request(app).get(`/api/v1/farms/${farmId}/plots`).set("Authorization", `Bearer ${viewer.accessToken}`);
    expect(read.status).toBe(200);

    const patch = await request(app)
      .patch(`/api/v1/farms/${farmId}`)
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .send({ name: "Viewer Renamed" });
    expect(patch.status).toBe(404);

    const stored = await prisma.farm.findUniqueOrThrow({ where: { id: farmId } });
    expect(stored.name).toBe("Org Farm");
    expect(stored.ownerId).toBe(owner.userId);
  });

  it("an org VIEWER cannot delete the farm (DELETE → 404, plots survive)", async () => {
    const { owner, farmId, invite } = await orgWithFarm();
    const viewer = await invite("VIEWER");
    const plot = await request(app)
      .post(`/api/v1/farms/${farmId}/plots`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Survivor", areaBigha: 1 });
    expect(plot.status).toBe(201);

    const del = await request(app).delete(`/api/v1/farms/${farmId}`).set("Authorization", `Bearer ${viewer.accessToken}`);
    expect(del.status).toBe(404);

    // The farm and its cascade targets are intact — this is the data-loss
    // assertion, not merely the status code.
    expect(await prisma.farm.count({ where: { id: farmId } })).toBe(1);
    expect(await prisma.plot.count({ where: { id: plot.body.data.id as string } })).toBe(1);
  });

  it("an org VIEWER cannot write farm data (plot create → 404)", async () => {
    const { farmId, invite } = await orgWithFarm();
    const viewer = await invite("VIEWER");

    const plot = await request(app)
      .post(`/api/v1/farms/${farmId}/plots`)
      .set("Authorization", `Bearer ${viewer.accessToken}`)
      .send({ name: "Viewer Plot", areaBigha: 1 });
    expect(plot.status).toBe(404);
    expect(await prisma.plot.count({ where: { farmId } })).toBe(0);
  });

  it("an org MEMBER may write farm data but not delete the farm", async () => {
    const { farmId, invite } = await orgWithFarm();
    const member = await invite("MEMBER");

    const patch = await request(app)
      .patch(`/api/v1/farms/${farmId}`)
      .set("Authorization", `Bearer ${member.accessToken}`)
      .send({ name: "Member Renamed" });
    expect(patch.status).toBe(200);
    expect((await prisma.farm.findUniqueOrThrow({ where: { id: farmId } })).name).toBe("Member Renamed");

    const plot = await request(app)
      .post(`/api/v1/farms/${farmId}/plots`)
      .set("Authorization", `Bearer ${member.accessToken}`)
      .send({ name: "Member Plot", areaBigha: 1 });
    expect(plot.status).toBe(201);

    // Destructive capability is org ADMIN only.
    const del = await request(app).delete(`/api/v1/farms/${farmId}`).set("Authorization", `Bearer ${member.accessToken}`);
    expect(del.status).toBe(404);
    expect(await prisma.farm.count({ where: { id: farmId } })).toBe(1);
  });

  it("an org ADMIN may write and delete", async () => {
    const { farmId, invite } = await orgWithFarm();
    const admin = await invite("ADMIN");

    const patch = await request(app)
      .patch(`/api/v1/farms/${farmId}`)
      .set("Authorization", `Bearer ${admin.accessToken}`)
      .send({ name: "Admin Renamed" });
    expect(patch.status).toBe(200);

    const del = await request(app).delete(`/api/v1/farms/${farmId}`).set("Authorization", `Bearer ${admin.accessToken}`);
    expect(del.status).toBe(200);
    expect(await prisma.farm.count({ where: { id: farmId } })).toBe(0);
  });

  it("the farm owner keeps full capability, and refuses a non-member as before", async () => {
    const { owner, farmId } = await orgWithFarm();
    const stranger = await registerFarmer();

    const patch = await request(app)
      .patch(`/api/v1/farms/${farmId}`)
      .set("Authorization", `Bearer ${owner.accessToken}`)
      .send({ name: "Owner Renamed" });
    expect(patch.status).toBe(200);
    const del = await request(app).delete(`/api/v1/farms/${farmId}`).set("Authorization", `Bearer ${owner.accessToken}`);
    expect(del.status).toBe(200);

    // The existence-oracle property the predicate's comment documents survives
    // the role check: an outsider gets the same 404 a VIEWER does.
    const outside = await request(app)
      .patch(`/api/v1/farms/${farmId}`)
      .set("Authorization", `Bearer ${stranger.accessToken}`)
      .send({ name: "Nope" });
    expect(outside.status).toBe(404);
  });

  it("a VIEWER gets the same 404 as a stranger — the refusal is not a role oracle", async () => {
    const { farmId, invite } = await orgWithFarm();
    const viewer = await invite("VIEWER");
    const stranger = await registerFarmer();

    const viewerPatch = await request(app).patch(`/api/v1/farms/${farmId}`).set("Authorization", `Bearer ${viewer.accessToken}`).send({ name: "Probe Farm" });
    const strangerPatch = await request(app).patch(`/api/v1/farms/${farmId}`).set("Authorization", `Bearer ${stranger.accessToken}`).send({ name: "Probe Farm" });
    expect(viewerPatch.status).toBe(404);
    expect(strangerPatch.status).toBe(404);
    expect(viewerPatch.body.error?.code).toBe(strangerPatch.body.error?.code);

    // A guessed, non-existent id is indistinguishable too.
    const missing = await request(app).patch("/api/v1/farms/does-not-exist").set("Authorization", `Bearer ${viewer.accessToken}`).send({ name: "Probe Farm" });
    expect(missing.status).toBe(404);
  });
});
