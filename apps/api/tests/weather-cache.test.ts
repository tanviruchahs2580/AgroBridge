import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { clearWeatherCache, getCachedWeather, setCachedWeather, weatherCacheKey, type CachedWeatherPayload } from "../src/modules/weather/cache.js";
import { MockWeatherProvider } from "../src/providers/weather/mock.js";
import { env } from "../src/config/env.js";

/**
 * A5-05: an identical weather request within the TTL is served from the
 * in-memory cache (provider called once), keeping the ORIGINAL `fetchedAt` and
 * reporting `cached: true`. Location keying rounds to 2 decimals. Provider
 * failures are never cached and never served stale. `env` is parsed once at
 * import, so TTL edge cases (expiry, TTL=0) are exercised against the cache
 * module directly with its injectable `now`/`ttlSeconds`.
 */

const coords = { lat: 25.9, lng: 89.1 };
const weatherUrl = (lat: number, lng: number) => `/api/v1/weather?lat=${lat}&lng=${lng}`;

function payloadAt(fetchedAt: number): CachedWeatherPayload {
  return {
    current: { tempC: 30, feelsLikeC: 33, humidityPct: 70, windKmh: 8, precipitationMm: 0, condition: "clear" },
    forecast: [],
    fetchedAt,
  };
}

beforeEach(() => clearWeatherCache());
afterEach(() => vi.restoreAllMocks());

describe("weather cache — route behaviour (default TTL)", () => {
  it("second identical request is cached; the provider is called once and fetchedAt is preserved", async () => {
    const spy = vi.spyOn(MockWeatherProvider.prototype, "getForecast");
    const f = await registerFarmer();
    const auth = { Authorization: `Bearer ${f.accessToken}` };

    const first = await request(app).get(weatherUrl(coords.lat, coords.lng)).set(auth);
    const second = await request(app).get(weatherUrl(coords.lat, coords.lng)).set(auth);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.data.cached).toBe(false);
    expect(second.body.data.cached).toBe(true);
    // Reuse keeps the ORIGINAL fetch time — a cached response never pretends to be newer.
    expect(second.body.data.fetchedAt).toBe(first.body.data.fetchedAt);
    expect(second.body.data.forecast).toEqual(first.body.data.forecast);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("coordinates rounding into the same 2-decimal bucket share an entry; a different bucket misses", async () => {
    const spy = vi.spyOn(MockWeatherProvider.prototype, "getForecast");
    const f = await registerFarmer();
    const auth = { Authorization: `Bearer ${f.accessToken}` };

    const a = await request(app).get(weatherUrl(25.904, 89.101)).set(auth); // → "25.90,89.10"
    const b = await request(app).get(weatherUrl(25.901, 89.104)).set(auth); // same bucket
    expect(a.body.data.cached).toBe(false);
    expect(b.body.data.cached).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);

    const c = await request(app).get(weatherUrl(25.95, 89.101)).set(auth); // → "25.95,89.10" — different
    expect(c.body.data.cached).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("a provider failure is an honest error — stale data is never served as current", async () => {
    const f = await registerFarmer();
    const auth = { Authorization: `Bearer ${f.accessToken}` };
    // An EXPIRED entry for the same coords exists (so a naive "serve the cache"
    // fallback would have something to serve) — it must not be used.
    setCachedWeather(coords.lat, coords.lng, payloadAt(Date.now() - (env.WEATHER_CACHE_TTL_SECONDS + 60) * 1000));
    vi.spyOn(MockWeatherProvider.prototype, "getForecast").mockRejectedValueOnce(new Error("provider outage"));

    const res = await request(app).get(weatherUrl(coords.lat, coords.lng)).set(auth);
    // AUD-V3: provider failures are explicit upstream errors now —
    // 502 WEATHER_PROVIDER_UNAVAILABLE, never a fabricated forecast.
    expect(res.status).toBe(502);
    expect(res.body.error.code).toBe("WEATHER_PROVIDER_UNAVAILABLE");
    expect(res.body.ok).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain("tempC");

    // The outage was not cached: the next successful call fetches afresh.
    const after = await request(app).get(weatherUrl(coords.lat, coords.lng)).set(auth);
    expect(after.status).toBe(200);
    expect(after.body.data.cached).toBe(false);
  });
});

describe("weather cache — module unit behaviour (TTL edge cases)", () => {
  it("keys by coordinates rounded to 2 decimals", () => {
    expect(weatherCacheKey(25.904, 89.096)).toBe("25.90,89.10");
    expect(weatherCacheKey(25.9, 89.1)).toBe("25.90,89.10");
    expect(weatherCacheKey(-6.1234, 106.9876)).toBe("-6.12,106.99");
  });

  it("serves a hit strictly inside the TTL and expires exactly at the boundary", () => {
    clearWeatherCache();
    const t0 = 1_000_000;
    setCachedWeather(1, 2, payloadAt(t0), 600);
    expect(getCachedWeather(1, 2, t0 + 599_000, 600)?.fetchedAt).toBe(t0);
    expect(getCachedWeather(1, 2, t0 + 600_000, 600)).toBeNull(); // boundary is expired
  });

  it("TTL=0 disables both reads and writes", () => {
    clearWeatherCache();
    setCachedWeather(3, 4, payloadAt(0), 0);
    expect(getCachedWeather(3, 4, 0, 0)).toBeNull(); // nothing was stored
    setCachedWeather(3, 4, payloadAt(0), 600);
    expect(getCachedWeather(3, 4, 0, 600)?.fetchedAt).toBe(0); // stored…
    expect(getCachedWeather(3, 4, 0, 0)).toBeNull(); // …but reads with TTL=0 bypass it
  });

  it("misses are null, and clearWeatherCache drops entries", () => {
    clearWeatherCache();
    expect(getCachedWeather(40, 50)).toBeNull();
    setCachedWeather(40, 50, payloadAt(Date.now()));
    expect(getCachedWeather(40, 50)).not.toBeNull();
    clearWeatherCache();
    expect(getCachedWeather(40, 50)).toBeNull();
  });

  it("the production default TTL comes from env and is active in this test profile", () => {
    // env is parsed once at import; with no override the documented default is
    // 600s (positive → caching enabled), which the route tests above exercise.
    expect(env.WEATHER_CACHE_TTL_SECONDS).toBeGreaterThan(0);
    clearWeatherCache();
    setCachedWeather(5, 6, payloadAt(Date.now()));
    expect(getCachedWeather(5, 6)).not.toBeNull();
  });
});
