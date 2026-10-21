import { UpstreamHttpError, withResilience } from "../resilience.js";
import type { CurrentWeather, DailyForecast, WeatherProvider } from "./types.js";
import { dhakaDate } from "./day.js";

const BASE = "https://api.openweathermap.org/data/2.5";
const FETCH_TIMEOUT_MS = 8_000;

export class OpenWeatherProvider implements WeatherProvider {
  readonly name = "openweather";
  constructor(private apiKey: string) {}

  /**
   * One GET under the shared resilience policy (timeout + bounded retry on
   * 5xx/429/network). The non-2xx branch stays INSIDE the attempt so the
   * policy classifies the status; when retries are exhausted the original
   * `openweather ... failed: <status>` error is rethrown unchanged.
   */
  private async get(what: "current" | "forecast", path: string): Promise<Response> {
    return withResilience(
      "openweather",
      async (signal) => {
        const res = await fetch(`${BASE}${path}&appid=${this.apiKey}`, { signal });
        if (!res.ok) throw new UpstreamHttpError(`openweather ${what} failed: ${res.status}`, res.status);
        return res;
      },
      { timeoutMs: FETCH_TIMEOUT_MS }
    );
  }

  async getCurrent(lat: number, lng: number): Promise<CurrentWeather> {
    const res = await this.get("current", `/weather?lat=${lat}&lon=${lng}&units=metric`);
    const j = (await res.json()) as {
      main: { temp: number; feels_like: number; humidity: number };
      wind: { speed: number };
      weather: { description: string }[];
      rain?: { "1h"?: number };
      dt?: number; // observation time, unix seconds 
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
    const res = await this.get("forecast", `/forecast?lat=${lat}&lon=${lng}&units=metric`);
    const j = (await res.json()) as {
      list: { dt_txt: string; main: { temp_min: number; temp_max: number; humidity: number }; wind: { speed: number }; rain?: { "3h"?: number } }[];
    };
    const byDate = new Map<string, { minC: number; maxC: number; rainMm: number; humidityPct: number; windKmh: number }>();
    for (const item of j.list.slice(0, days * 8)) {
      // dt_txt is UTC ("YYYY-MM-DD HH:MM:SS") — bucket by the Dhaka calendar
      // day (see day.ts), so an evening UTC slot lands on the local day it
      // actually belongs to. `+ "Z"` pins the parse to UTC.
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
