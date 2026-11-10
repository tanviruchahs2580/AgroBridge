/**
 * My Farm screen (F-29 — 86 lines of farm/plot/crop UI with 0% coverage).
 *
 * The screen is where a farmer's records are entered, so the paths worth pinning
 * are the ones that write: the farm list and its stats come off one read, an
 * "add plot" form posts to that farm, and the plot-crop select offers a prompt
 * instead of repeating the field's label as if it were a value.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";

const calls: { method: string; path: string; body?: unknown }[] = [];

/** Minimal WeatherData with no actionable advisory — the page renders without a risk banner. */
const weatherPayload = {
  provider: "mock",
  source: "mock",
  fetchedAt: "2026-11-10T00:00:00.000Z",
  cached: false,
  current: { tempC: 28, feelsLikeC: 30, humidityPct: 70, windKmh: 8, precipitationMm: 0, condition: "CLEAR", source: "mock" },
  forecast: [],
  risks: [{ type: "INFO", severity: "LOW", titleBn: "আবহাওয়া অনুকূল", titleEn: "Weather favourable", actionBn: "", actionEn: "" }],
  advisories: [],
};

const farms = [
  {
    id: "f1",
    name: "উত্তর মাঠ",
    district: "রংপুর",
    totalAreaBigha: 2.5,
    plots: [
      {
        id: "pl1",
        name: "প্লট ১",
        areaBigha: 1.5,
        cropCycles: [
          { id: "c1", cropName: "RICE", stage: "VEGETATIVE", status: "ACTIVE", plantedAt: "2026-10-01T00:00:00.000Z" },
        ],
      },
      { id: "pl2", name: "প্লট ২", areaBigha: 1, cropCycles: [] },
    ],
  },
];

const mockApi = vi.fn((...args: unknown[]) => {
  const method = args[0] as string;
  const path = args[1] as string;
  calls.push({ method, path, body: args[2] });
  if (method === "GET" && path === "/farms") return Promise.resolve(farms);
  if (method === "GET" && path.startsWith("/weather")) return Promise.resolve(weatherPayload);
  if (method === "POST" && path.endsWith("/plots")) return Promise.resolve({ ok: true });
  return Promise.resolve({});
});

vi.mock("../../lib/session", () => ({
  useSession: () => ({ session: { lang: "bn", fullName: "Test", role: "FARMER", district: "রংপুর" }, refresh: async () => {} }),
}));
vi.mock("../../lib/api.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api.js")>("../../lib/api.js");
  return { ...actual, api: (...args: unknown[]) => mockApi(...args) };
});
vi.mock("../../lib/analytics.js", () => ({ track: () => {} }));

import MyFarm from "./MyFarm";
import { dict } from "../../lib/i18n";
import { cropLabel } from "../../lib/labels";

/**
 * Roots mounted by the current test. Tracked so a failing assertion still tears
 * the tree down: a leaked mount keeps its useResource subscription alive, and the
 * next test in the file then sees an invalidate refetch from the previous test's
 * component (observed as an extra GET in the request log).
 */
const mountedRoots: { unmount: () => void }[] = [];

function mount(node: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  let alive = true;
  const unmount = () => {
    if (!alive) return;
    alive = false;
    act(() => root.unmount());
    container.remove();
  };
  mountedRoots.push({ unmount });
  return { unmount };
}

async function flush(times = 2) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function buttonWithText(needle: string): HTMLButtonElement {
  const hit = Array.from(document.querySelectorAll("button")).find((b) => (b.textContent ?? "").includes(needle));
  if (!hit) throw new Error(`no button containing "${needle}"`);
  return hit as HTMLButtonElement;
}

const NATIVE_VALUE_SETTER = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

async function type(el: HTMLInputElement, value: string) {
  await act(async () => {
    if (NATIVE_VALUE_SETTER) NATIVE_VALUE_SETTER.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  calls.length = 0;
  document.body.innerHTML = "";
  mockApi.mockClear();
});

afterEach(() => {
  while (mountedRoots.length) mountedRoots.pop()!.unmount();
  document.body.innerHTML = "";
});

describe("features/farms — MyFarm (F-29)", () => {
  it("renders the farm, its plots, the derived stats and the crop's localized stage", async () => {
    const { unmount } = mount(
      <MemoryRouter>
        <MyFarm />
      </MemoryRouter>
    );
    await flush();

    expect(document.body.textContent).toContain("উত্তর মাঠ");
    // Derived from the read, not restated: the farm card prints the plot count it
    // counted and the area it summed, and the overview tiles exist only because
    // at least one farm does.
    expect(document.body.textContent).toContain(`2 ${dict.myFarmPlotCount.bn}`);
    expect(document.body.textContent).toContain("2.5");
    expect(document.body.textContent).toContain(dict.myFarmActiveCropsStat.bn);
    expect(document.body.textContent).toContain(dict.totalLand.bn);
    // Today's tasks name the crop through the shared label map, in Bengali.
    expect(document.body.textContent).toContain(cropLabel("RICE", "bn"));
    // The farm-card list heading is the dictionary's, in the chosen register (খামার).
    expect(document.body.textContent).toContain(dict.myFarmListTitle.bn);
    unmount();
  });

  it("posts a new plot to its farm from the inline form", async () => {
    const { unmount } = mount(
      <MemoryRouter>
        <MyFarm />
      </MemoryRouter>
    );
    await flush();

    await act(async () => {
      buttonWithText(dict.addPlot.bn).click();
    });
    const plotForm = document.querySelector("form");
    expect(plotForm).toBeTruthy();
    await type(document.querySelector<HTMLInputElement>('input[name="name"]')!, "নতুন প্লট");
    await type(document.querySelector<HTMLInputElement>('input[name="area"]')!, "1.2");
    await act(async () => {
      buttonWithText(dict.submit.bn).click();
    });
    await flush();

    const post = calls.find((c) => c.method === "POST");
    expect(post?.path).toBe("/farms/f1/plots");
    expect(post?.body).toMatchObject({ name: "নতুন প্লট", areaBigha: 1.2 });
    unmount();
  });

  it("offers a select prompt rather than the field label as the empty crop option", async () => {
    const { unmount } = mount(
      <MemoryRouter>
        <MyFarm />
      </MemoryRouter>
    );
    await flush();
    // Open the farm detail (its own view) and the crop form inside a plot.
    await act(async () => {
      buttonWithText(dict.myFarmViewPlots.bn).click();
    });
    await act(async () => {
      buttonWithText(dict.addCrop.bn).click();
    });

    const select = document.querySelector("select");
    expect(select).toBeTruthy();
    const emptyOption = select!.querySelector('option[value=""]');
    expect(emptyOption?.textContent).toBe(dict.selectCropPrompt.bn);
    expect(emptyOption?.textContent).not.toBe(dict.cropName.bn);
    unmount();
  });
});
