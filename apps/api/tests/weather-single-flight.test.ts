import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { clearWeatherCache, getOrLoadWeather, type CachedWeatherPayload } from "../src/modules/weather/cache.js";
import { MockWeatherProvider } from "../src/providers/weather/mock.js";

/**
 * F-07 from the 10k-concurrency audit: the cache had no single-flight, so N
 * concurrent requests for an un-cached location each called the provider.
 * Measured at 1 000 concurrent requests: 12.66 CPU-s cold against 7.35 CPU-s
 * warm — 5.3 CPU-seconds of duplicated provider work, one call per caller. With
 * the documented production provider that is 1 000 outbound HTTPS calls.
 */

const coords = { lat: 30.11, lng: 91.11 };
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

describe("weather cache single-flight (unit)", () => {
  it("50 concurrent misses perform exactly one load, and all receive that payload", async () => {
    // A real instant: the cache treats an ancient `fetchedAt` as already expired,
    // which would send every later read back to the loader for the right reason.
    const fetchedAt = Date.now();
    let loads = 0;
    const loader = async () => {
      loads++;
      await new Promise((r) => setTimeout(r, 10)); // in-flight long enough to be joined
      return payloadAt(fetchedAt);
    };

    const results = await Promise.all(Array.from({ length: 50 }, () => getOrLoadWeather(coords.lat, coords.lng, loader)));

    expect(loads).toBe(1);
    expect(results.every((r) => r.payload.fetchedAt === fetchedAt)).toBe(true);
    // Only the very first caller can claim neither a stored entry nor a shared
    // fetch; a coalesced caller must NOT report a cache hit.
    expect(results.every((r) => r.cached === false)).toBe(true);

    const after = await getOrLoadWeather(coords.lat, coords.lng, loader);
    expect(loads).toBe(1);
    expect(after.cached).toBe(true);
    expect(after.payload.fetchedAt).toBe(fetchedAt);
  });

  it("propagates a provider failure to every waiter and caches nothing", async () => {
    let attempts = 0;
    const failing = async () => {
      attempts++;
      throw new Error("provider down");
    };

    const settled = await Promise.allSettled(Array.from({ length: 10 }, () => getOrLoadWeather(coords.lat, coords.lng, failing)));
    expect(settled.every((s) => s.status === "rejected")).toBe(true);
    expect(attempts, "an outage is one failure shared, not ten failed calls").toBe(1);

    // A later request must try again rather than inherit the settled rejection.
    const fresh = Date.now();
    const retry = await getOrLoadWeather(coords.lat, coords.lng, async () => payloadAt(fresh));
    expect(retry.cached).toBe(false);
    expect(retry.payload.fetchedAt).toBe(fresh);
  });

  it("with caching disabled (TTL=0) every caller loads its own payload", async () => {
    let loads = 0;
    const loader = async () => payloadAt(++loads);
    const results = await Promise.all(
      Array.from({ length: 3 }, () => getOrLoadWeather(coords.lat, coords.lng, loader, Date.now(), 0)),
    );
    expect(loads).toBe(3);
    expect(results.every((r) => r.cached === false)).toBe(true);
  });
});

describe("weather cache single-flight (route)", () => {
  it("25 simultaneous requests for a cold location call the provider once", async () => {
    const spy = vi.spyOn(MockWeatherProvider.prototype, "getForecast");
    const f = await registerFarmer();
    const auth = { Authorization: `Bearer ${f.accessToken}` };

    const responses = await Promise.all(
      Array.from({ length: 25 }, () => request(app).get(weatherUrl(coords.lat, coords.lng)).set(auth)),
    );

    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(spy, "the stampede must collapse into one provider call").toHaveBeenCalledTimes(1);

    const fetchedAt = responses[0]!.body.data.fetchedAt;
    expect(responses.every((r) => r.body.data.fetchedAt === fetchedAt)).toBe(true);
    expect(responses.some((r) => r.body.data.cached === false)).toBe(true);

    // And the stored entry is reused afterwards — the TTL behaviour is intact.
    const next = await request(app).get(weatherUrl(coords.lat, coords.lng)).set(auth);
    expect(next.status).toBe(200);
    expect(next.body.data.cached).toBe(true);
    expect(next.body.data.fetchedAt).toBe(fetchedAt);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
