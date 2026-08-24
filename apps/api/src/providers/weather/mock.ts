import type { CurrentWeather, DailyForecast, WeatherProvider } from "./types.js";

/**
 * Deterministic offline weather provider for development/test/demo.
 * Clearly NOT production data — selected only when WEATHER_PROVIDER=mock
 * or when no real provider credentials are configured (Rule 53/63).
 */
export class MockWeatherProvider implements WeatherProvider {
  readonly name = "mock";

  async getCurrent(lat: number): Promise<CurrentWeather> {
    // Deterministic pseudo-climate: hotter toward the equator, mild noise by longitude.
    const base = 32 - Math.abs(lat) * 0.15;
    const wobble = ((lng: number) => Math.sin(lng) * 2)(lat * 0 + Math.abs(lat)) ;
    const tempC = Number((base + wobble).toFixed(1));
    return {
      tempC,
      feelsLikeC: Number((tempC + 3).toFixed(1)),
      humidityPct: 78,
      windKmh: 12,
      precipitationMm: 0,
      condition: "Partly cloudy",
    };
  }

  async getForecast(lat: number, _lng: number, days: number): Promise<DailyForecast[]> {
    const current = await this.getCurrent(lat);
    const out: DailyForecast[] = [];
    for (let i = 0; i < Math.min(Math.max(days, 1), 7); i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      out.push({
        date: d.toISOString().slice(0, 10),
        minC: Number((current.tempC - 6).toFixed(1)),
        maxC: Number((current.tempC + 4).toFixed(1)),
        rainMm: i % 3 === 2 ? 18 : i % 3 === 1 ? 6 : 0,
        humidityPct: 70 + (i % 3) * 8,
        windKmh: 10 + (i % 3),
      });
    }
    return out;
  }
}
