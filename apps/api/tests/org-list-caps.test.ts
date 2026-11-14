import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app, createUserWithRole, uniquePhone } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { ORG_LIST_CAPS } from "../src/modules/organizations/routes.js";

/**
 * F-06: organisation nested lists used to be unbounded — one GET /organizations
 * request could return every member of every org the caller can see, and
 * GET /organizations/:id/farms could return every farm with every plot.
 *
 * Same discipline as farms-list-caps.test.ts (ARC-15/API-05): seed more rows
 * than any cap allows and assert the returned lengths exactly, so an unbounded
 * (or wrongly sized) response fails. Membership is created directly in the DB —
 * POST /organizations/:id/members exists, but the surplus rows here are test
 * fixtures, not behaviour under test.
 */
describe("organization nested-list caps (F-06)", () => {
  const OVER_MEMBERS = ORG_LIST_CAPS.membersPerOrg + 5; // 55
  const OVER_FARMS = ORG_LIST_CAPS.farmsPerOrg; // top-level farm list is capped too
  const OVER_PLOTS = ORG_LIST_CAPS.plotsPerFarm + 5; // 55

  let corp: Awaited<ReturnType<typeof createUserWithRole>>;
  let orgId: string;
  let farmId: string;

  beforeAll(async () => {
    corp = await createUserWithRole("CORPORATE");
    const org = await request(app)
      .post("/api/v1/organizations")
      .set("Authorization", `Bearer ${corp.accessToken}`)
      .send({ name: "Cap Org", type: "CORPORATE" });
    expect(org.status).toBe(201);
    orgId = org.body.data.id;

    // More members than the cap. The creator is already a member (ADMIN), so
    // seed one fewer synthetic rows. Membership rows need real users (FK), so
    // create the user rows first — role/password content is irrelevant to the
    // cap, these users never log in.
    const memberRows = Array.from({ length: OVER_MEMBERS - 1 }, (_, i) => ({
      fullName: `ক্যাপ সদস্য-${i + 1}`,
      phone: uniquePhone(),
      passwordHash: "test-hash",
      role: "FARMER",
    }));
    const users = await prisma.user.createManyAndReturn({ data: memberRows });
    await prisma.organizationMember.createMany({
      data: users.map((u) => ({ organizationId: orgId, userId: u.id, role: "VIEWER" })),
    });

    // More farms than the org cap, each with more plots than the plot cap.
    const farmRows = Array.from({ length: OVER_FARMS }, (_, i) => ({
      ownerId: corp.userId,
      organizationId: orgId,
      name: `ক্যাপ ফার্ম-${i + 1}`,
      district: "Dhaka",
    }));
    // createMany with nested includes is not supported — create farms, then plots.
    const farms = [];
    for (const row of farmRows) {
      farms.push(await prisma.farm.create({ data: row }));
    }
    farmId = farms[0]!.id;
    await prisma.plot.createMany({
      data: Array.from({ length: OVER_PLOTS }, (_, i) => ({ farmId, name: `প্লট-${i + 1}`, areaBigha: 0.01 })),
    });
  }, 60_000);

  it("pins the cap values", () => {
    expect(ORG_LIST_CAPS).toEqual({ membersPerOrg: 50, farmsPerOrg: 50, plotsPerFarm: 50 });
  });

  it("GET /organizations truncates nested members to membersPerOrg, total count intact", async () => {
    const res = await request(app).get("/api/v1/organizations").set("Authorization", `Bearer ${corp.accessToken}`);
    expect(res.status).toBe(200);
    const org = (res.body.data as { id: string; members: unknown[]; _count: { members: number } }[]).find((o) => o.id === orgId);
    expect(org, "the seeded org must be in the response").toBeTruthy();
    expect(org!.members).toHaveLength(ORG_LIST_CAPS.membersPerOrg);
    expect(org!._count.members).toBe(OVER_MEMBERS);
  });

  it("GET /organizations/:id/farms truncates both the farm list and its nested plots", async () => {
    const res = await request(app).get(`/api/v1/organizations/${orgId}/farms`).set("Authorization", `Bearer ${corp.accessToken}`);
    expect(res.status).toBe(200);
    const farms = res.body.data as { id: string; plots: unknown[] }[];
    expect(farms).toHaveLength(ORG_LIST_CAPS.farmsPerOrg);

    const seededFarm = farms.find((f) => f.id === farmId);
    expect(seededFarm, "the over-seeded farm must be inside the cap window").toBeTruthy();
    expect(seededFarm!.plots).toHaveLength(ORG_LIST_CAPS.plotsPerFarm);
  });
});
