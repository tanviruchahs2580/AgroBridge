import { env } from "../../config/env.js";
import type { CurrentWeather, DailyForecast } from "../../providers/weather/types.js";

/**
 * Small in-memory TTL cache for successful weather payloads (A5-05).
 *
 * Keyed by the location rounded to 2 decimals (`${lat.toFixed(2)},${lng.toFixed(2)}`):
 * nearby farms inside ~1 km share one provider call. `fetchedAt` is stamped
 * ONCE at fetch time and is never rewritten on reuse, so a cached response
 * keeps the ORIGINAL provenance time and clients can see the data's real age
 * (AUD-126 / A5-01) instead of a cache-reuse timestamp.
 *
 * Only successful provider payloads are ever stored. A provider failure is
 * never cached and cache entries are never served as a fallback for a failed
 * refresh: an outage is an honest error, not stale "current" weather shown as
 * fresh — a farmer deciding on a spray must not see yesterday's wind.
 *
 * TTL comes from `env.WEATHER_CACHE_TTL_SECONDS` (0 disables read AND write).
 * `env` is parsed once per process, so the optional `now`/`ttlSeconds`
 * parameters exist so unit tests can exercise expiry and the disabled path
 * deterministically; production callers omit them.
 */

export interface CachedWeatherPayload {
  current: CurrentWeather;
  forecast: DailyForecast[];
  /** Epoch ms of the successful provider fetch (never rewritten on reuse). */
  fetchedAt: number;
}

const entries = new Map<string, CachedWeatherPayload>();

export function weatherCacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

/**
 * Returns the cached payload when it exists AND is still within the TTL;
 * `null` otherwise (miss, expired, or caching disabled). Expired entries are
 * dropped on access so the map cannot grow without bound in a long-running
 * process with bounded distinct locations.
 */
export function getCachedWeather(
  lat: number,
  lng: number,
  now: number = Date.now(),
  ttlSeconds: number = env.WEATHER_CACHE_TTL_SECONDS,
): CachedWeatherPayload | null {
  if (ttlSeconds <= 0) return null; // TTL=0 disables caching entirely
  const key = weatherCacheKey(lat, lng);
  const hit = entries.get(key);
  if (!hit) return null;
  if (now - hit.fetchedAt >= ttlSeconds * 1000) {
    entries.delete(key);
    return null;
  }
  return hit;
}

/** Stores a successful payload. Never called with a failed fetch — see above. */
export function setCachedWeather(
  lat: number,
  lng: number,
  payload: CachedWeatherPayload,
  ttlSeconds: number = env.WEATHER_CACHE_TTL_SECONDS,
): void {
  if (ttlSeconds <= 0) return;
  entries.set(weatherCacheKey(lat, lng), payload);
}

/** Test helper: drop every entry (and any in-flight load) so tests start clean. */
export function clearWeatherCache(): void {
  entries.clear();
  inFlight.clear();
}

/**
 * Single-flight (F-07 from the 10k-concurrency audit).
 *
 * A TTL cache stops *repeat* traffic from reaching the provider but does nothing
 * about simultaneous traffic on a key that is not cached yet: every concurrent
 * caller missed, fetched, and stored the same entry. Measured cost of that
 * stampede: 1 000 concurrent requests for one cold location burned 12.66 CPU-s
 * against 7.35 CPU-s for the same 1 000 on a warm key — 5.3 CPU-seconds of
 * duplicated provider work, one call per caller. With the documented production
 * provider (`openweather`) each of those is an outbound HTTPS request against an
 * 8 s timeout, so a cold key after a deploy — or at 6 a.m., the hour this feature
 * exists for — turns into a burst of provider calls and provider-side rate limits.
 *
 * So the first caller loads and the rest await the same promise. Everything else
 * is unchanged: the TTL, the rule that only successful payloads are ever stored,
 * and `fetchedAt` stamped once at fetch time. A coalesced request is served the
 * same fresh payload the first caller received — never a stored entry — which is
 * why it reports `cached: false`.
 *
 * A failing load rejects every waiter: they would each have failed on their own,
 * and an outage must stay an honest error rather than be masked by a neighbour
 * having succeeded.
 */
const inFlight = new Map<string, Promise<CachedWeatherPayload>>();

export interface WeatherLoadResult {
  payload: CachedWeatherPayload;
  /** True only when a stored entry was reused; a coalesced await is a fresh fetch. */
  cached: boolean;
}

export async function getOrLoadWeather(
  lat: number,
  lng: number,
  loader: () => Promise<CachedWeatherPayload>,
  now: number = Date.now(),
  ttlSeconds: number = env.WEATHER_CACHE_TTL_SECONDS,
): Promise<WeatherLoadResult> {
  const hit = getCachedWeather(lat, lng, now, ttlSeconds);
  if (hit) return { payload: hit, cached: true };

  // TTL=0 means caching is disabled, not "coalesce anyway": each request is
  // explicitly asking for its own fresh fetch.
  if (ttlSeconds <= 0) return { payload: await loader(), cached: false };

  const key = weatherCacheKey(lat, lng);
  const existing = inFlight.get(key);
  if (existing) return { payload: await existing, cached: false };

  const load = (async () => {
    try {
      const payload = await loader();
      setCachedWeather(lat, lng, payload, ttlSeconds);
      return payload;
    } finally {
      // Cleared before awaiters resume, so a request arriving after a failure
      // starts a fresh attempt instead of joining an already-settled rejection.
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, load);
  return { payload: await load, cached: false };
}
