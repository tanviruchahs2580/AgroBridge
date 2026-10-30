import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenWeatherProvider } from "../src/providers/weather/openweather.js";
import { UpstreamHttpError } from "../src/providers/resilience.js";

/**
 * A5-03: provider-specific units, timezone, nulls, rate limits and status
 * errors are normalized through the adapter, covered by fixtures shaped like
 * the real provider payloads.
 *
 * Fixtures live in tests/fixtures/weather/ and are modelled on the documented
 * OpenWeather 2.5 response shapes (https://openweathermap.org/current,
 * https://openweathermap.org/forecast5) trimmed to the fields the adapter
 * reads — including the fields it must cope WITHOUT (no `dt`, no `rain`, no
 * `sys.pod`), which is where invented data used to leak in.
 *
 * Failure-path retry semantics are the shared resilience policy's job (see
 * resilience.test.ts); this file proves the weather adapter feeds it the right
 * classified status, including 429 (retryable once) vs 401 (final).
 */

const FIXTURES = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "fixtures/weather");
const load = (name: string) => JSON.parse(readFileSync(path.join(FIXTURES, name), "utf8")) as unknown;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("weather adapter — provider response fixtures (A5-03)", () => {
  it("maps the documented current-weather payload, converting m/s→km/h and reading rain.1h", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return { ok: true, json: async () => load("openweather-current-200.json") };
    });

    const p = new OpenWeatherProvider("fixture-key");
    const cur = await p.getCurrent(23.7104, 90.4074);

    // Unit normalization: the request asks for metric and the adapter converts
    // the one field the API reports in m/s (wind) to the km/h the UI shows.
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/weather?");
    expect(calls[0]).toContain("lat=23.7104");
    expect(calls[0]).toContain("lon=90.4074");
    expect(calls[0]).toContain("units=metric");
    expect(calls[0]).toContain("appid=fixture-key");

    expect(cur.tempC).toBe(30.5);
    expect(cur.feelsLikeC).toBe(35.2);
    expect(cur.humidityPct).toBe(78);
    expect(cur.windKmh).toBeCloseTo(9.0, 10); // 2.5 m/s
    expect(cur.precipitationMm).toBe(1.2); // rain["1h"]
    expect(cur.condition).toBe("light rain");
    expect(cur.observedAt).toBe(new Date(1_781_500_000 * 1000).toISOString());
  });

  it("nulls are defaulted, never invented: no rain → 0 mm, no dt → no observedAt, no weather[] → 'unknown'", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({
        main: { temp: 28, feels_like: 31, humidity: 65 },
        wind: { speed: 1 },
        weather: [],
      }),
    }));

    const cur = await new OpenWeatherProvider("k").getCurrent(23.7, 90.4);
    expect(cur.precipitationMm).toBe(0);
    expect(cur.condition).toBe("unknown");
    expect("observedAt" in cur).toBe(false);
  });

  it("buckets forecast slots by the Dhaka calendar day — the 18:00Z slot belongs to the NEXT Dhaka day", async () => {
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => load("openweather-forecast-200.json"),
    }));

    const days = await new OpenWeatherProvider("k").getForecast(23.7104, 90.4074, 3);

    // Two Dhaka days come out of the fixture's eight 3-hourly slots.
    expect(days.map((d) => d.date)).toEqual(["2026-06-15", "2026-06-16"]);

    // Day 1: 00:00Z/03:00Z/06:00Z (all pre-18:00Z) — min 27.9, max 34.5, rain 2.4.
    expect(days[0]).toMatchObject({ minC: 27.9, maxC: 34.5, rainMm: 2.4, humidityPct: 84 });
    expect(days[0]?.windKmh ?? -1).toBeCloseTo(6.48, 10);

    // Day 2 starts with the 18:00Z slot (Dhaka midnight) — and is where the
    // missing `rain` field on the last slot must contribute 0, not NaN.
    expect(days[1]).toMatchObject({ minC: 26.4, maxC: 34.9, humidityPct: 88 });
    expect(days[1]?.rainMm ?? -1).toBeCloseTo(29.9, 10); // 5.7 + 8.1 + 14.2 + 1.9 + 0
    expect(days[1]?.windKmh ?? -1).toBeCloseTo(7.92, 10);
  });

  it("a 429 is a rate limit: retried once, then surfaced with its status — exactly two attempts", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return { ok: false, status: 429 };
    });

    const p = new OpenWeatherProvider("k");
    await expect(p.getCurrent(23.7, 90.4)).rejects.toMatchObject({ status: 429 });
    expect(calls).toBe(2);
  });

  it("a 401 is final: one attempt, the status is preserved, no retry", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return { ok: false, status: 401 };
    });

    const p = new OpenWeatherProvider("k");
    const err = await p.getCurrent(23.7, 90.4).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamHttpError);
    expect((err as UpstreamHttpError).status).toBe(401);
    expect(calls).toBe(1);
  });
});
