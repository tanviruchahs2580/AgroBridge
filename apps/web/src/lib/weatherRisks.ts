// Which weather advisories are worth acting on.
//
// The API ships every advisory it has — including INFO-level, LOW-severity ones
// whose text is reassurance (the mock provider's first entry is literally
// "Weather favourable"). Treating the list as "the risks" therefore paints good
// news as a caution: MyFarm rendered `risks[0]` in an amber warning box with a
// TriangleAlert icon and no filter, so a favourable advisory appeared as a
// warning while Home — which filtered — correctly showed no risk at all. Two
// screens, one payload, opposite conclusions.
//
// One definition, used by both: an actionable risk is not INFO and not LOW.
import type { WeatherData } from "./api-types";

export type WeatherRisk = WeatherData["risks"][number];

export function actionableRisks(weather: WeatherData | null | undefined): WeatherRisk[] {
  return weather ? weather.risks.filter((r) => r.type !== "INFO" && r.severity !== "LOW") : [];
}
