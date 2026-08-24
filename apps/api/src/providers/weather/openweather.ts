import type { CurrentWeather, DailyForecast, WeatherProvider } from "./types.js";

const BASE = "https://api.openweathermap.org/data/2.5";
const FETCH_TIMEOUT_MS = 8_000;

export class OpenWeatherProvider implements WeatherProvider {
  readonly name = "openweather";
  constructor(private apiKey: string) {}

  async getCurrent(lat: number, lng: number): Promise<CurrentWeather> {
    const res = await fetch(`${BASE}/weather?lat=${lat}&lon=${lng}&units=metric&appid=${this.apiKey}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`openweather current failed: ${res.status}`);
    const j = (await res.json()) as {
      main: { temp: number; feels_like: number; humidity: number };
      wind: { speed: number };
      weather: { description: string }[];
      rain?: { "1h"?: number };
    };
    return {
      tempC: j.main.temp,
      feelsLikeC: j.main.feels_like,
      humidityPct: j.main.humidity,
      windKmh: j.wind.speed * 3.6,
      precipitationMm: j.rain?.["1h"] ?? 0,
      condition: j.weather[0]?.description ?? "unknown",
    };
  }

  async getForecast(lat: number, lng: number, days: number): Promise<DailyForecast[]> {
    const res = await fetch(`${BASE}/forecast?lat=${lat}&lon=${lng}&units=metric&appid=${this.apiKey}`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`openweather forecast failed: ${res.status}`);
    const j = (await res.json()) as {
      list: { dt_txt: string; main: { temp_min: number; temp_max: number; humidity: number }; wind: { speed: number }; rain?: { "3h"?: number } }[];
    };
    const byDate = new Map<string, { minC: number; maxC: number; rainMm: number; humidityPct: number; windKmh: number }>();
    for (const item of j.list.slice(0, days * 8)) {
      const date = item.dt_txt.slice(0, 10);
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
