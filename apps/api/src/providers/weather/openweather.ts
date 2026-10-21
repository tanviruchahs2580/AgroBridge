import type { CurrentWeather, DailyForecast, WeatherProvider } from "./types.js";
import { dhakaDate } from "./day.js";
import { createCircuit, withResilience } from "../../infrastructure/resilience.js";

const BASE = "https://api.openweathermap.org/data/2.5";
const FETCH_TIMEOUT_MS = 8_000;

// Shared breaker for the OpenWeather surface (ARC-09): after 4 consecutive
// infrastructure faults the adapter refuses for 60s instead of hammering a
// rate-limited provider, with one half-open probe afterwards. Business answers
// (401/404) neither break nor retry; 5xx and 429 do.
const circuit = createCircuit({ threshold: 4, openMs: 60_000 });

function isWeatherFault(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? "";
  return (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN" ||
    code === "ENOTFOUND" ||
    code === "OPENWEATHER_5XX" ||
    code === "OPENWEATHER_RATE_LIMITED"
  );
}

export class OpenWeatherProvider implements WeatherProvider {
  readonly name = "openweather";
  constructor(private apiKey: string) {}

  private async getJson(pathAndQuery: string, signal: AbortSignal): Promise<unknown> {
    const res = await fetch(`${BASE}${pathAndQuery}&appid=${this.apiKey}`, { signal });
    if (res.status === 429) {
      const err = new Error(`openweather rate limited: 429 (${pathAndQuery})`);
      (err as { code?: string }).code = "OPENWEATHER_RATE_LIMITED";
      throw err;
    }
    if (res.status >= 500) {
      const err = new Error(`openweather server error: ${res.status} (${pathAndQuery})`);
      (err as { code?: string }).code = "OPENWEATHER_5XX";
      throw err;
    }
    if (!res.ok) throw new Error(`openweather request failed: ${res.status} (${pathAndQuery})`);
    return res.json();
  }

  /** One resilient provider call: 8s timeout, one retry with backoff, shared breaker. */
  private call(pathAndQuery: string): Promise<unknown> {
    return withResilience(
      circuit,
      { timeoutMs: FETCH_TIMEOUT_MS, retries: 1, retryBaseMs: 500, openMs: 60_000, isFault: isWeatherFault },
      (attemptSignal) => this.getJson(pathAndQuery, attemptSignal),
    )();
  }

  async getCurrent(lat: number, lng: number): Promise<CurrentWeather> {
    const j = (await this.call(`/weather?lat=${lat}&lon=${lng}&units=metric`)) as {
      main: { temp: number; feels_like: number; humidity: number };
      wind: { speed: number };
      weather: { description: string }[];
      rain?: { "1h"?: number };
      dt?: number; // observation time, unix seconds (AUD-126 / A5-01)
    };
    return {
      tempC: j.main.temp,
      feelsLikeC: j.main.feels_like,
      humidityPct: j.main.humidity,
      windKmh: j.wind.speed * 3.6,
      precipitationMm: j.rain?.["1h"] ?? 0,
      condition: j.weather[0]?.description ?? "unknown",
      // The provider's own observation instant — omitted (not invented) if the
      // body carries no `dt`.
      ...(typeof j.dt === "number" ? { observedAt: new Date(j.dt * 1000).toISOString() } : {}),
    };
  }

  async getForecast(lat: number, lng: number, days: number): Promise<DailyForecast[]> {
    const j = (await this.call(`/forecast?lat=${lat}&lon=${lng}&units=metric`)) as {
      list: { dt_txt: string; main: { temp_min: number; temp_max: number; humidity: number }; wind: { speed: number }; rain?: { "3h"?: number } }[];
    };
    const byDate = new Map<string, { minC: number; maxC: number; rainMm: number; humidityPct: number; windKmh: number }>();
    for (const item of j.list.slice(0, days * 8)) {
      // dt_txt is UTC ("YYYY-MM-DD HH:MM:SS") — bucket by the Dhaka calendar
      // day (see day.ts), so an evening UTC slot lands on the local day it
      // actually belongs to. `+ "Z"` pins the parse to UTC. The per-day wind and
      // humidity keep the FIRST slot's values (the original aggregation).
      const date = dhakaDate(`${item.dt_txt.replace(" ", "T")}Z`);
      const agg =
        byDate.get(date) ??
        { minC: Infinity, maxC: -Infinity, rainMm: 0, humidityPct: item.main.humidity, windKmh: item.wind.speed * 3.6 };
      agg.minC = Math.min(agg.minC, item.main.temp_min);
      agg.maxC = Math.max(agg.maxC, item.main.temp_max);
      agg.rainMm += item.rain?.["3h"] ?? 0;
      byDate.set(date, agg);
    }
    return [...byDate.entries()].slice(0, days).map(([date, v]) => ({ date, ...v }));
  }
}
