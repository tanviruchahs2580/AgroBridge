import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FARM_LIST_CAPS } from "../src/modules/farms/routes.js";

/**
 * ARC-15/API-05: nested farm lists (plots → crop cycles, events) used to be
 * unbounded — one request could return a farm's entire history. Seeding 60
 * plots per test would be heavy, so instead the caps are exported and pinned
 * here, together with a source-shape check that every nested include actually
 * carries the cap (a constant no query uses would satisfy a value-only
 * assertion while leaving the response unbounded).
 */
describe("farm nested-list caps (ARC-15/API-05)", () => {
  it("pins the cap values", () => {
    expect(FARM_LIST_CAPS).toEqual({ plotsPerFarm: 50, cropCyclesPerPlot: 50, eventsPerRequest: 100 });
  });

  it("every cap is used in a take/limit clause in farms/routes.ts", () => {
    const src = readFileSync(new URL("../src/modules/farms/routes.ts", import.meta.url), "utf8");

    expect(src).toContain("take: FARM_LIST_CAPS.plotsPerFarm");
    // GET /farms (nested under a farm) and GET /farms/:id/plots both cap cycles.
    expect((src.match(/take: FARM_LIST_CAPS\.cropCyclesPerPlot/g) ?? []).length).toBe(2);
    expect(src).toContain("max(FARM_LIST_CAPS.eventsPerRequest)");

    // No nested cropCycles include is left without a take.
    for (const line of src.split("\n")) {
      if (line.includes("cropCycles: {")) expect(line).toContain("take:");
    }
  });
});
