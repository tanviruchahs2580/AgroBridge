import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app, registerFarmer, createFarmWithCrop } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { FARM_LIST_CAPS } from "../src/modules/farms/routes.js";

/**
 * ARC-15/API-05: nested farm lists (plots → crop cycles, events) used to be
 * unbounded — one request could return a farm's entire history.
 *
 * This file used to assert the cap with `expect(src).toContain("take:
 * FARM_LIST_CAPS.plotsPerFarm")` — a check on the source *text*, not on a
 * response. It passed as long as those exact characters existed anywhere in the
 * file, including in a dead branch, and could not see an include that had lost
 * its take. The tests below seed more rows than any cap allows and assert the
 * returned lengths exactly, so an unbounded (or wrongly sized) response fails.
 */
describe("farm nested-list caps (ARC-15/API-05)", () => {
  const OVER_PLOTS = FARM_LIST_CAPS.plotsPerFarm + 5; // 55
  const OVER_CYCLES = FARM_LIST_CAPS.cropCyclesPerPlot + 5; // 55
  const OVER_EVENTS = FARM_LIST_CAPS.eventsPerRequest + 5; // 105

  let farmer: Awaited<ReturnType<typeof registerFarmer>>;
  let farmId: string;
  let plotId: string;

  beforeAll(async () => {
    farmer = await registerFarmer();
    ({ farmId, plotId } = await createFarmWithCrop(farmer.accessToken, "ধান", 30));

    // More plots than the cap; total-area checks do not run on createMany.
    await prisma.plot.createMany({
      data: Array.from({ length: OVER_PLOTS - 1 }, (_, i) => ({ farmId, name: `প্লট-${i + 2}`, areaBigha: 0.01 })),
    });
    // More cycles than the cap on the first plot. A partial unique index allows
    // only one ACTIVE cycle per plot (AUD-V3), so the surplus is HARVESTED —
    // exactly the history the cap exists to bound.
    await prisma.cropCycle.createMany({
      data: Array.from({ length: OVER_CYCLES - 1 }, (_, i) => ({
        plotId,
        cropName: "ধান",
        plantedAt: new Date(Date.now() - (i + 1) * 86_400_000),
        status: "HARVESTED",
      })),
    });
    // More events than the cap.
    await prisma.farmEvent.createMany({
      data: Array.from({ length: OVER_EVENTS }, (_, i) => ({
        farmId,
        actorId: farmer.user.id,
        type: "OTHER",
        title: `event ${i}`,
        occurredAt: new Date(Date.now() - i * 60_000),
      })),
    });
  }, 60_000);

  it("pins the cap values", () => {
    expect(FARM_LIST_CAPS).toEqual({ plotsPerFarm: 50, cropCyclesPerPlot: 50, eventsPerRequest: 100 });
  });

  it("GET /farms returns exactly plotsPerFarm plots and cropCyclesPerPlot cycles, not the farm's history", async () => {
    const res = await request(app).get("/api/v1/farms").set("Authorization", `Bearer ${farmer.accessToken}`);
    expect(res.status).toBe(200);
    const farm = (res.body.data as { id: string; plots: { id: string; cropCycles: unknown[] }[]; _count: { plots: number } }[]).find((f) => f.id === farmId);
    expect(farm, "the seeded farm must be in the response").toBeTruthy();

    expect(farm!.plots).toHaveLength(FARM_LIST_CAPS.plotsPerFarm);
    // The truncated list still tells the caller how many rows exist.
    expect(farm!._count.plots).toBe(OVER_PLOTS);

    const seededPlot = farm!.plots.find((p) => p.id === plotId);
    expect(seededPlot, "the over-seeded plot must be inside the cap window").toBeTruthy();
    // GET /farms nests only the plot's ACTIVE cycle (partial unique index: at
    // most one), so the assertion is that the include is still there at all.
    expect(seededPlot!.cropCycles).toHaveLength(1);
  });

  it("GET /farms/:id/plots is capped the same way, cycles included", async () => {
    const res = await request(app).get(`/api/v1/farms/${farmId}/plots`).set("Authorization", `Bearer ${farmer.accessToken}`);
    expect(res.status).toBe(200);
    const plots = res.body.data as { id: string; cropCycles: unknown[] }[];
    expect(plots).toHaveLength(FARM_LIST_CAPS.plotsPerFarm);

    const seededPlot = plots.find((p) => p.id === plotId);
    expect(seededPlot, "the over-seeded plot must be inside the cap window").toBeTruthy();
    expect(seededPlot!.cropCycles).toHaveLength(FARM_LIST_CAPS.cropCyclesPerPlot);
  });

  it("GET /farms/:id/events honours the requested limit up to eventsPerRequest and refuses more", async () => {
    const auth = { Authorization: `Bearer ${farmer.accessToken}` };
    const capped = await request(app).get(`/api/v1/farms/${farmId}/events?limit=${FARM_LIST_CAPS.eventsPerRequest}`).set(auth);
    expect(capped.status).toBe(200);
    expect(capped.body.data).toHaveLength(FARM_LIST_CAPS.eventsPerRequest);

    const smaller = await request(app).get(`/api/v1/farms/${farmId}/events?limit=10`).set(auth);
    expect(smaller.body.data).toHaveLength(10);

    // Above the cap the query is rejected, not silently clamped to something else.
    const over = await request(app).get(`/api/v1/farms/${farmId}/events?limit=${FARM_LIST_CAPS.eventsPerRequest + 1}`).set(auth);
    expect(over.status).toBe(400);
  });
});
