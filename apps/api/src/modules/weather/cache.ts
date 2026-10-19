import { env } from "../../config/env.js";
import type { CurrentWeather, DailyForecast } from "../../providers/weather/types.js";

/**
 * Small in-memory TTL cache for successful weather payloads.
 *
 * Keyed by the location rounded to 2 decimals (`${lat.toFixed(2)},${lng.toFixed(2)}`):
 * nearby farms inside ~1 km share one provider call. `fetchedAt` is stamped
 * ONCE at fetch time and is never rewritten on reuse, so a cached response
 * keeps the ORIGINAL provenance time and clients can see the data's real age
 * instead of a cache-reuse timestamp.
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

/** Test helper: drop every entry so tests start from a known state. */
export function clearWeatherCache(): void {
  entries.clear();
}
