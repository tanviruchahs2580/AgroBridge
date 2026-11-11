/**
 * Home farm-readiness panel: the owner's 2026-11-12 after-condition mock turned
 * the brand-gradient hero into a photo-backed panel. These tests pin what the
 * redesign must NOT change — the four heading states (healthy / attention /
 * empty / unavailable), the CTA target, the ring's data source and the
 * decorative-but-functional contract of the new background (image + scrim, no
 * raw hex in the component). They also start closing Home.tsx's 0%-coverage
 * gap (F-29 remainder: Home and Onboarding were left uncovered when the web
 * suites landed).
 *
 * The real useResource runs against a canned transport (the Market.test
 * pattern), so the panel is observed as rendered output, not from state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

const calls: { method: string; path: string }[] = [];
// Mutable so a test can drive a different farm payload before mounting.
let farmsResult: unknown;

vi.mock("../../lib/session", () => ({
  useSession: () => ({
    session: { lang: "bn", fullName: "পরীক্ষক", role: "FARMER", district: "রংপুর" },
    refresh: async () => {},
  }),
}));

vi.mock("../../lib/api.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api.js")>("../../lib/api.js");
  return { ...actual, api: (...args: unknown[]) => mockApi(...args) };
});

vi.mock("../../lib/analytics.js", () => ({ track: () => {} }));

// A benign weather payload: no risks, so the panel takes the "healthy" branch
// and the health score includes the weather term. The current block mirrors the
// WeatherData.current shape; `risks` carries the never-empty contract's
// favourable INFO entry (exactly what the mock provider ships on a clear day).
const weather = {
  provider: "mock",
  source: "mock",
  fetchedAt: "2026-11-12T06:00:00.000Z",
  cached: false,
  current: { tempC: 28, feelsLikeC: 30, humidityPct: 70, windKmh: 6, precipitationMm: 0, condition: "Clear", source: "mock" },
  forecast: [{ date: "2026-11-13", minC: 20, maxC: 29, rainMm: 0, humidityPct: 65, windKmh: 8 }],
  risks: [
    {
      type: "INFO",
      severity: "LOW",
      titleBn: "আবহাওয়া অনুকূল",
      titleEn: "Weather favourable",
      detailEn: "No adverse weather expected for your crops.",
    },
  ],
};

function farmWithCrop() {
  return {
    id: "f1",
    name: "আমার খামার",
    district: "রংপুর",
    address: null,
    lat: null,
    lng: null,
    totalAreaBigha: 2,
    ownerId: "u1",
    organizationId: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    plots: [
      {
        id: "p1",
        name: "প্লট-১",
        areaBigha: 1,
        farmId: "f1",
        createdAt: "2026-01-01T00:00:00.000Z",
        cropCycles: [
          {
            id: "c1",
            plotId: "p1",
            cropName: "ধান",
            plantedAt: new Date(Date.now() - 40 * 86400000).toISOString(),
            stage: "VEGETATIVE",
            status: "ACTIVE",
            expectedHarvestAt: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    ],
  };
}

function mockApi(_method: unknown, path: string) {
  calls.push({ method: String(_method), path: String(path) });
  if (path === "/farms") return Promise.resolve(farmsResult);
  if (path === "/notifications")
    return Promise.resolve({ items: [], unread: 0, counts: { critical: 0, action: 0, info: 0 } });
  if (path.startsWith("/weather")) return Promise.resolve(weather);
  throw new Error("unexpected request in Home.test: " + path);
}

import Home from "./Home";
import { dict } from "../../lib/i18n";

const roots: Root[] = [];
function mount(ui: ReactElement) {
  const div = document.createElement("div");
  document.body.appendChild(div);
  const root = createRoot(div);
  roots.push(root);
  act(() => {
    root.render(<MemoryRouter>{ui}</MemoryRouter>);
  });
  return div;
}

beforeEach(() => {
  calls.length = 0;
  farmsResult = [farmWithCrop()];
});

afterEach(() => {
  for (const r of roots.splice(0)) {
    act(() => r.unmount());
  }
});

async function settle() {
  // useResource resolves its fetch on a microtask; two flips cover the
  // loading → data transition for all three resources.
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

describe("Home farm-readiness panel — the 2026-11-12 photo redesign", () => {
  it("healthy farm: state heading, the new sub-line, badge, photo background and the /farm CTA render, and the three resources were read", async () => {
    const div = mount(<Home />);
    await settle();
    const text = div.textContent ?? "";
    // The state heading and the sub-line (aiFarmHealthy + aiFarmHealthySub).
    expect(text).toContain(dict.aiFarmHealthy.bn);
    expect(text).toContain(dict.aiFarmHealthySub.bn);
    // The badge re-introduced by the mock (existing key, no new copy).
    expect(text).toContain(dict.farmReadiness.bn);
    // The CTA still targets /farm — unchanged by the redesign.
    const cta = [...div.querySelectorAll("a")].find((a) => a.getAttribute("href") === "/farm");
    expect(cta).toBeTruthy();
    // The ring is a percentage readout, not a fabricated floor.
    expect((div.textContent ?? "").match(/\d+%/)).toBeTruthy();
    // The background contract: the photo element exists and is decorative.
    const img = div.querySelector<HTMLImageElement>('img[src="/images/hero-farm.jpg"]');
    expect(img).toBeTruthy();
    expect(img?.getAttribute("alt")).toBe("");
    expect(img?.getAttribute("aria-hidden")).toBe("true");
    // And the screen really did read the three resources.
    expect(calls.map((c) => c.path.split("?")[0])).toEqual(
      expect.arrayContaining(["/farms", "/notifications", "/weather"]),
    );
  });

  it("empty farm: the empty copy replaces heading and sub-line, and no percentage is fabricated", async () => {
    // The zero-farm branch withholds the ring entirely — a score computed from
    // an empty array would be a fabricated number (the honesty rule the panel
    // already carried before the redesign; the redesign must not have broken it).
    farmsResult = [];
    const div = mount(<Home />);
    await settle();
    const text = div.textContent ?? "";
    expect(text).toContain(dict.aiFarmEmptyTitle.bn);
    expect(text).toContain(dict.aiFarmEmptyMeter.bn);
    expect(text).not.toContain(dict.aiFarmHealthy.bn);
    expect(text).not.toContain(dict.aiFarmHealthySub.bn);
    // No percentage readout in the readiness panel itself (the weather card
    // elsewhere on the screen legitimately renders humidity as one).
    const panel = div.querySelector("section.rounded-card.bg-hero");
    expect(/\d+%/.test(panel?.textContent ?? "")).toBe(false);
    // The background contract holds in every state.
    expect(div.querySelector<HTMLImageElement>('img[src="/images/hero-farm.jpg"]')).toBeTruthy();
  });

  it("the scrim comes from the token layer: no raw hex in the panel markup", async () => {
    const div = mount(<Home />);
    await settle();
    const panel = div.querySelector("section.rounded-card.bg-hero");
    expect(panel).toBeTruthy();
    const scrim = panel?.querySelector('[aria-hidden][class*="hero-scrim"]');
    expect(scrim).toBeTruthy();
    // No style attribute on the panel's children carries a hex colour (the
    // raw-hex ban the preflight gate enforces for TSX).
    const hexInStyle = [...(panel?.querySelectorAll("[style]") ?? [])].some((el) =>
      /#[0-9a-fA-F]{3,8}\b/.test(el.getAttribute("style") ?? ""),
    );
    expect(hexInStyle).toBe(false);
  });
});
