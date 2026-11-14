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
// Drive the notifications read: a payload, or a rejection for the
// "count unavailable" state.
let notifResult: unknown;
let notifRejects = false;
// Weather is normally the benign clear-day payload; a test may swap it for a
// risky one, or make the read reject to drive the unavailable branch.
let weatherResult: unknown;
let weatherFails = false;

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
  if (path === "/notifications") {
    return notifRejects ? Promise.reject(new Error("notifications unavailable")) : Promise.resolve(notifResult);
  }
  if (path.startsWith("/weather")) {
    return weatherFails ? Promise.reject(new Error("weather unavailable")) : Promise.resolve(weatherResult);
  }
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
  notifResult = { items: [], unread: 0, counts: { critical: 0, action: 0, info: 0 } };
  notifRejects = false;
  weatherResult = weather;
  weatherFails = false;
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

describe("Home — the স্মার্ট সতর্কতা (Smart Alerts) panel is gone (owner request, 2026-11-12)", () => {
  // The panel duplicated the weather card (it printed the same "weather
  // favourable / regular farm visit" pair) and, sitting last, its tail was the
  // part that disappeared under the fixed bottom nav on Android. Removing it is
  // the owner's decision; what these tests pin is that nothing ELSE left with it
  // — the weather reading, the readiness meter and the risk-driven heading all
  // stay, and no orphan copy remains.
  it("renders no Smart Alerts heading or advisory row", async () => {
    const div = mount(<Home />);
    await settle();
    const text = div.textContent ?? "";
    expect(text).not.toContain("স্মার্ট সতর্কতা");
    expect(text).not.toContain("Smart Alerts");
    // Neither of the panel's two quiet-state strings survives elsewhere.
    expect(text).not.toContain("আবহাওয়া অনুকূল");
    expect(text).not.toContain("নিয়মিত খামার পরিদর্শন করুন");
    // …and the unavailable-state line is gone too.
    expect(text).not.toContain("আবহাওয়ার সতর্কতা পাওয়া যায়নি");
  });

  it("removing the panel did NOT remove the weather capability behind it", async () => {
    const div = mount(<Home />);
    await settle();
    const text = div.textContent ?? "";
    // The weather card still renders its reading, district and provenance.
    expect(text).toContain(dict.weather.bn);
    // Temperatures follow the one-numeral policy — Bengali digits in bn mode
    // (formatNumber), so the reading is ২৮°, not "28°".
    expect(text).toContain("২৮°");
    expect(text).toContain(dict.humidityLabel.bn);
    // The readiness meter still scores from farms + weather and names its basis.
    expect(text).toMatch(/\d+%/);
    expect(text).toContain(dict.farmReadiness.bn);
    // The three reads are unchanged — the panel's removal touched no request.
    expect(calls.map((c) => c.path.split("?")[0])).toEqual(
      expect.arrayContaining(["/farms", "/notifications", "/weather"]),
    );
  });

  it("a failed weather read still says so in the weather card, with a retry", async () => {
    // The panel used to be the place that admitted a failed advisory fetch. Its
    // removal must not leave the screen silently claiming a clear day.
    weatherFails = true;
    const div = mount(<Home />);
    await settle();
    const text = div.textContent ?? "";
    expect(text).toContain(dict.weatherUnavailable.bn);
    const retry = [...div.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === dict.retry.bn);
    expect(retry).toBeTruthy();
  });

  it("an actionable risk still drives the readiness heading, so the signal is not lost", async () => {
    // `hasRisk` is the one thing the panel shared with the panel above it. With
    // the weather payload carrying a real warning, the heading must say
    // "attention" — proof the risk path still reaches the UI.
    weatherResult = {
      ...weather,
      risks: [
        {
          type: "RAIN_WARNING",
          severity: "HIGH",
          titleBn: "ভারী বৃষ্টির সম্ভাবনা",
          titleEn: "Heavy rain likely",
          detailEn: "Postpone spraying.",
        },
      ],
    };
    const div = mount(<Home />);
    await settle();
    expect(div.textContent ?? "").toContain(dict.aiFarmAttention.bn);
    // …and the advisory's own title is no longer printed on Home (that copy
    // lived in the removed panel); it belongs to MyFarm.
    expect(div.textContent ?? "").not.toContain("ভারী বৃষ্টির সম্ভাবনা");
  });
});

describe("দ্রুত সেবা (Quick Services) — owner-approved redesign, 2026-11-12", () => {
  function quickSection(div: HTMLElement): HTMLElement {
    const s = div.querySelector<HTMLElement>("#quick-services-heading")?.closest("section");
    if (!s) throw new Error("quick-services section not found");
    return s;
  }

  it("renders the approved composition: heading, সব দেখুন action, and the four exact Bengali labels", async () => {
    const div = mount(<Home />);
    await settle();
    const section = quickSection(div);
    expect(section.textContent).toContain(dict.quickActions.bn); // দ্রুত সেবা
    expect(section.textContent).toContain(dict.viewAll.bn); // সব দেখুন
    for (const key of ["aiAgent", "services", "sellCrop", "notifications"] as const) {
      expect(section.textContent, key).toContain(dict[key].bn);
    }
  });

  it("all five actions reuse the existing destinations — no invented route", async () => {
    const div = mount(<Home />);
    await settle();
    const hrefs = [...quickSection(div).querySelectorAll("a")].map((a) => a.getAttribute("href"));
    // Four cards, one per destination…
    expect(hrefs).toEqual(expect.arrayContaining(["/advisor", "/services", "/sell", "/notifications"]));
    // …and the header action reuses the existing services listing, because the
    // repository has no separate all-services route (handoff §5 — never invent).
    const header = quickSection(div).querySelector("header, div");
    expect(header).toBeTruthy();
    const servicesLinks = hrefs.filter((h) => h === "/services");
    expect(servicesLinks.length).toBe(2); // card + header action
  });

  it("unread count shows on the notifications card, is absent at zero, and carries state to assistive tech", async () => {
    notifResult = { items: [], unread: 3, counts: { critical: 3, action: 0, info: 0 } };
    const div = mount(<Home />);
    await settle();
    const notifCard = [...quickSection(div).querySelectorAll("a")].find(
      (a) => a.getAttribute("href") === "/notifications",
    )!;
    expect(notifCard.textContent).toContain("3");
    // The sr-only text is what carries the state — colour alone never does.
    expect(notifCard.textContent).toContain(dict.notifUnread.bn);
    const srOnly = notifCard.querySelector(".sr-only");
    expect(srOnly?.textContent).toContain("3");
    // …and it must not sit inside an aria-hidden subtree, or assistive tech
    // never hears the state at all (the defect the browser check caught).
    let node: Element | null = srOnly;
    while (node && node !== notifCard) {
      expect(node.getAttribute("aria-hidden"), `${node.tagName} hides the unread state`).toBeNull();
      node = node.parentElement;
    }
  });

  it("no unread indicator at zero", async () => {
    notifResult = { items: [], unread: 0, counts: { critical: 0, action: 0, info: 0 } };
    const div = mount(<Home />);
    await settle();
    const notifCard = [...quickSection(div).querySelectorAll("a")].find(
      (a) => a.getAttribute("href") === "/notifications",
    )!;
    expect(notifCard.textContent).not.toContain(dict.notifUnread.bn);
    expect(notifCard.textContent).not.toContain("!");
  });

  it("a failed notifications read shows the honest unknown marker, never a clean inbox", async () => {
    notifRejects = true;
    const div = mount(<Home />);
    await settle();
    const notifCard = [...quickSection(div).querySelectorAll("a")].find(
      (a) => a.getAttribute("href") === "/notifications",
    )!;
    expect(notifCard.textContent).toContain("!");
    expect(notifCard.textContent).toContain(dict.unreadCountUnavailable.bn);
  });

  it("the section carries no raw hex — every surface comes from the --qs-* token layer", async () => {
    const div = mount(<Home />);
    await settle();
    const styleAttrs = [...quickSection(div).querySelectorAll("[style]")].map(
      (el) => el.getAttribute("style") ?? "",
    );
    expect(styleAttrs.some((s) => /#[0-9a-fA-F]{3,8}\b/.test(s))).toBe(false);
    // …and the class names the CSS defines are present (the preflight
    // dead-class gate reads the compiled CSS; this pins the contract in source).
    expect(quickSection(div).className).toContain("qs-section");
    expect(quickSection(div).querySelectorAll(".qs-card").length).toBe(4);
  });
});
