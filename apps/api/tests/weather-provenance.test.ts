import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { clearWeatherCache } from "../src/modules/weather/cache.js";
import { MOCK_REFERENCE_NOW, MockWeatherProvider } from "../src/providers/weather/mock.js";
import { OpenWeatherProvider } from "../src/providers/weather/openweather.js";

/**
 * AUD-126 / A5-01: the weather response must carry provenance, additively —
 * `source` (provider slug), `fetchedAt` (when the data was retrieved from the
 * provider), `current.observedAt` (the provider's own observation time when it
 * reports one), the Dhaka forecast `date`, and `cached` (A5-05 cache reuse).
 * Nothing is ever fabricated: when the provider reports no observation time
 * the field is absent, and a provider failure renders as an error — never as
 * invented weather.
 */

beforeEach(() => clearWeatherCache());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("weather provenance — response envelope", () => {
  it("the mock response carries source/fetchedAt/cached and a deterministic observedAt", async () => {
    const f = await registerFarmer();
    const res = await request(app).get("/api/v1/weather?lat=25.9&lng=89.1").set("Authorization", `Bearer ${f.accessToken}`);
    expect(res.status).toBe(200);
    const d = res.body.data as {
      provider: string;
      source: string;
      fetchedAt: string;
      cached: boolean;
      current: { source: string; observedAt?: string };
      forecast: { date: string }[];
    };

    expect(d.provider).toBe("mock");
    expect(d.source).toBe("mock"); // provider slug, explicit
    expect(d.cached).toBe(false);
    expect(Number.isNaN(new Date(d.fetchedAt).getTime())).toBe(false);
    expect(d.current.source).toBe("mock");
    // Derived from the fixed reference instant — never the wall clock.
    expect(d.current.observedAt).toBe(MOCK_REFERENCE_NOW.toISOString());
    // Forecast days are the Dhaka calendar days from the reference.
    expect(d.forecast.map((x) => x.date)).toEqual(["2026-06-15", "2026-06-16", "2026-06-17"]);
  });

  it("the mock payload is fully deterministic: identical requests (cache cleared) are byte-identical", async () => {
    const f = await registerFarmer();
    const auth = { Authorization: `Bearer ${f.accessToken}` };
    const first = await request(app).get("/api/v1/weather?lat=24.374&lng=88.601").set(auth);
    clearWeatherCache(); // force a fresh provider call, not a cache reuse
    const second = await request(app).get("/api/v1/weather?lat=24.374&lng=88.601").set(auth);
    expect(second.body.data.current).toEqual(first.body.data.current);
    expect(second.body.data.forecast).toEqual(first.body.data.forecast);
    expect(second.body.data.risks).toEqual(first.body.data.risks);
  });

  it("openweather reports observedAt from the provider's own `dt`", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({
        dt: 1_781_500_000,
        main: { temp: 30, feels_like: 33, humidity: 70 },
        wind: { speed: 2 },
        weather: [{ description: "clear sky" }],
      }),
    }));
    const cur = await new OpenWeatherProvider("test-key").getCurrent(25.9, 89.1);
    expect(cur.observedAt).toBe(new Date(1_781_500_000 * 1000).toISOString());
  });

  it("openweather omits observedAt when the body has no `dt` — nothing is invented", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({
        main: { temp: 30, feels_like: 33, humidity: 70 },
        wind: { speed: 2 },
        weather: [{ description: "clear sky" }],
      }),
    }));
    const cur = await new OpenWeatherProvider("test-key").getCurrent(25.9, 89.1);
    expect("observedAt" in cur).toBe(false);
  });

  it("a provider failure is an error response — never fabricated weather", async () => {
    const f = await registerFarmer();
    vi.spyOn(MockWeatherProvider.prototype, "getForecast").mockRejectedValueOnce(new Error("provider down"));
    const res = await request(app).get("/api/v1/weather?lat=25.9&lng=89.1").set("Authorization", `Bearer ${f.accessToken}`);
    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain("tempC");
  });
});
