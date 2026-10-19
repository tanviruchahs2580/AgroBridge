// Weather provenance line.
//
// One small, honest line under the current conditions: WHEN the payload was
// fetched from the provider (local clock) and from WHICH source. On a cache hit
// the ORIGINAL fetch time is kept — relabelling a stored payload with the
// response time is exactly the dishonesty this line exists to prevent — and the
// "cached copy" marker says so instead. No interpretation, no forecast claim:
// just the facts the API's provenance envelope carries.
import type { WeatherData } from "../../lib/api-types";
import { dateLocale } from "../../lib/format";
import { t } from "../../lib/i18n";
import type { Lang } from "../../lib/i18n";

/** Local-clock HH:MM for an ISO instant (bn-BD / en-GB, per dateLocale). */
function localHhMm(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(dateLocale(lang), { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** e.g. "Weather as of 14:05 · openweather" or "… · openweather · cached copy". */
export function weatherProvenanceLine(
  weather: Pick<WeatherData, "fetchedAt" | "source" | "cached">,
  lang: Lang
): string {
  const parts = [t("weatherAsOf", lang, { time: localHhMm(weather.fetchedAt, lang) }), weather.source];
  if (weather.cached) parts.push(t("weatherCachedCopy", lang));
  return parts.join(" · ");
}
