// AUD-112: Home's "Today's tasks" must be derived from the user's real crop
// cycles — no hard-coded checklist, no fabricated progress. These tests pin
// that contract on the pure derivation the card renders.
import { describe, expect, it } from "vitest";
import { deriveTodayTasks } from "./todayTasks";
import { farmCareSuggestion } from "../../lib/labels";
import type { FarmListItem } from "../../lib/api-types";

function cycle(id: string, cropName: string, stage: string, plantedAt: string, status = "ACTIVE") {
  return { id, cropName, stage, plantedAt, status };
}

function farm(name: string, cycles: ReturnType<typeof cycle>[]): FarmListItem {
  return {
    id: `farm-${name}`,
    ownerId: "u1",
    organizationId: null,
    name,
    address: null,
    district: null,
    upazila: null,
    lat: null,
    lng: null,
    totalAreaBigha: null,
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    plots: [{ id: `plot-${name}`, name: `Plot ${name}`, areaBigha: 1, soilType: null, irrigationType: null, cropCycles: cycles }],
    _count: { plots: 1 },
    organization: null,
  };
}

describe("features/home/todayTasks — deriveTodayTasks", () => {
  it("returns nothing when there are no farms or no crop cycles", () => {
    expect(deriveTodayTasks([], "bn")).toEqual([]);
    expect(deriveTodayTasks([farm("A", [])], "bn")).toEqual([]);
  });

  it("derives one task per ACTIVE cycle straight from the farm data (not a fixed list)", () => {
    const farms = [
      farm("Home", [cycle("c1", "RICE", "VEGETATIVE", "2026-09-20T00:00:00.000Z")]),
      farm("Back field", [cycle("c2", "POTATO", "SEED", "2026-10-16T00:00:00.000Z")]),
    ];
    const tasks = deriveTodayTasks(farms, "bn");
    expect(tasks.map((t) => t.id)).toEqual(["c1", "c2"]);
    expect(tasks.map((t) => t.cropName)).toEqual(["RICE", "POTATO"]);
    expect(tasks[0].farmName).toBe("Home");
    expect(tasks[1].plotName).toBe("Plot Back field");
    // The care line is the same derivation MyFarm shows — not an invented item.
    expect(tasks[0].care).toEqual(farmCareSuggestion({ stage: "VEGETATIVE", plantedAt: "2026-09-20T00:00:00.000Z" }, "bn"));
  });

  it("ignores non-ACTIVE cycles — a harvested crop has no pending today task", () => {
    const farms = [farm("A", [cycle("harvested", "RICE", "HARVEST", "2026-05-01T00:00:00.000Z", "HARVESTED")])];
    expect(deriveTodayTasks(farms, "bn")).toEqual([]);
  });

  it("caps the visible list at the limit, in farm/plot/cycle order", () => {
    const many = ["a", "b", "c", "d"].map((n, i) => cycle(n, "RICE", "SEED", `2026-10-0${i + 1}T00:00:00.000Z`));
    const tasks = deriveTodayTasks([farm("A", many)], "en", 3);
    expect(tasks.map((t) => t.id)).toEqual(["a", "b", "c"]);
  });

  it("localises the care label/task per language", () => {
    const farms = [farm("A", [cycle("c1", "RICE", "FLOWERING", "2026-10-10T00:00:00.000Z")])];
    const bn = deriveTodayTasks(farms, "bn")[0].care;
    const en = deriveTodayTasks(farms, "en")[0].care;
    expect(bn.task).not.toBe(en.task);
    expect(bn.label).not.toBe(en.label);
  });
});
