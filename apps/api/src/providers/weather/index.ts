import { env } from "../../config/env.js";
import { MockWeatherProvider } from "./mock.js";
import { OpenWeatherProvider } from "./openweather.js";
import type { WeatherProvider } from "./types.js";

export * from "./types.js";

export function getWeatherProvider(): WeatherProvider {
  if (env.WEATHER_PROVIDER === "openweather" && env.OPENWEATHER_API_KEY) {
    return new OpenWeatherProvider(env.OPENWEATHER_API_KEY);
  }
  return new MockWeatherProvider();
}
