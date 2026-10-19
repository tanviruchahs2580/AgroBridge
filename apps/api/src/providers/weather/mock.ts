import type { CurrentWeather, DailyForecast, WeatherProvider } from "./types.js";
import { dhakaDate } from "./day.js";

/**
 * Fixed reference instant for the fixture provider. The whole mock payload is
 * a function of latitude and this constant only — no wall clock — so identical
 * requests produce byte-identical responses and tests can assert exact
 * timestamps/dates. It is explicitly NOT current weather.
 * 2026-06-15T00:00:00Z == 06:00 on 2026-06-15 in Dhaka.
 */
export const MOCK_REFERENCE_NOW = new Date("2026-06-15T00:00:00Z");

/**
 * Deterministic offline weather provider for development/test/demo.
 * Clearly NOT production data — selected only when WEATHER_PROVIDER=mock
 * or when no real provider credentials are configured.
 */
export class MockWeatherProvider implements WeatherProvider {
  readonly name = "mock";

  async getCurrent(lat: number): Promise<CurrentWeather> {
    // Deterministic pseudo-climate for dev/tests: hotter toward the equator,
    // with a small reproducible latitudinal band so values are never constant.
    const base = 32 - Math.abs(lat) * 0.15;
    const wobble = Math.sin(Math.abs(lat)) * 2;
    const tempC = Number((base + wobble).toFixed(1));
    return {
      tempC,
      feelsLikeC: Number((tempC + 3).toFixed(1)),
      humidityPct: 78,
      windKmh: 12,
      precipitationMm: 0,
      condition: "Partly cloudy",
      // Derived deterministically from the fixed reference instead of "now":
      // fixture data must never masquerade as a live observation.
      observedAt: MOCK_REFERENCE_NOW.toISOString(),
    };
  }

  async getForecast(lat: number, _lng: number, days: number): Promise<DailyForecast[]> {
    const current = await this.getCurrent(lat);
    const out: DailyForecast[] = [];
    for (let i = 0; i < Math.min(Math.max(days, 1), 7); i++) {
      // Fixed reference + UTC-date arithmetic: the Dhaka calendar day of each
      // bucket is deterministic regardless of the host timezone.
      const d = new Date(MOCK_REFERENCE_NOW);
      d.setUTCDate(d.getUTCDate() + i);
      out.push({
        // Grouped on the Dhaka calendar day, like the live adapter (day.ts).
        date: dhakaDate(d),
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
