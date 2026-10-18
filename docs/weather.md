# Weather intelligence

`GET /api/v1/weather?lat=..&lng=..&cropStage=..` (authenticated) returns current
conditions, a 3-day forecast and derived agricultural risks. Providers:
`WEATHER_PROVIDER=mock` (fixture data, default outside production) or
`openweather` (requires `OPENWEATHER_API_KEY`). Code:
`apps/api/src/providers/weather/` (adapters, risk rules, Dhaka-day helper) and
`apps/api/src/modules/weather/` (route + TTL cache).

## Units

| Field | Unit |
| --- | --- |
| `tempC`, `feelsLikeC`, `minC`, `maxC` | °C |
| `windKmh` | km/h (OpenWeather reports m/s — the adapter converts ×3.6) |
| `precipitationMm`, `rainMm` | mm (OpenWeather: `rain.1h` / summed `rain.3h` buckets) |
| `humidityPct` | % relative humidity |
| `date`, `fetchedAt`, `observedAt` | `YYYY-MM-DD` in Asia/Dhaka; ISO 8601 UTC instants |

## Risk rules

`deriveAgriRisks` (`apps/api/src/providers/weather/types.ts`) converts weather
into advisories. Rules, thresholds and severities:

| Rule | Trigger | Severity | Guidance (En) |
| --- | --- | --- | --- |
| `SPRAY_WARNING` | wind > 15 km/h | HIGH if > 25, else MODERATE | Spray drift wastes product and can damage neighbours; wait for calmer conditions |
| `RAIN_WARNING` | today's rain > 10 mm | HIGH if > 30, else MODERATE | Delay fertilizer/pesticide application; ensure drainage |
| `HEAT_WARNING` | temp ≥ 35 °C | HIGH | Irrigate morning/evening; avoid midday field work |
| `IRRIGATION_ADVICE` | today's rain < 2 mm AND no day in the next 3 with rain > 5 mm | MODERATE | No meaningful rainfall in 3 days — plan irrigation within 48 h |
| `DISEASE_RISK` | humidity > 85 % AND 20 °C ≤ temp ≤ 30 °C | HIGH | Fungal/bacterial disease risk; scout fields, confirm treatment via disease detection or an agronomist |
| `INFO` | none of the above fired | LOW | Conditions favourable — always returned when the list would otherwise be empty |

**Honest limitation:** thresholds are deliberately **crop- and stage-agnostic**.
They are general agronomic heuristics, not crop-specific models — `cropStage` only
appears in the heat-warning body text. A rice blast threshold differs from a
mustard aphid threshold, and neither is modelled here; do not present these
advisories as crop-calibrated advice. Crop-specific thresholds are future work.

Titles/detail strings are bilingual (Bengali title + English title/detail);
`detailEn` is the field the web renders today.

## Provenance contract (AUD-126 / A5-01)

Every successful response carries:

| Field | Meaning |
| --- | --- |
| `provider` / `source` | Provider slug (`mock` / `openweather`) — `source` mirrors it; `current.source` repeats it |
| `fetchedAt` | ISO instant the payload was retrieved from the provider. On a cache reuse this is the **original** fetch time, never the reuse time |
| `current.observedAt` | The provider's own observation instant (OpenWeather `dt`). **Absent** — never invented — when the provider reports none |
| `forecast[].date` | The forecast bucket's calendar day in **Asia/Dhaka** (UTC+6, no DST). Slots from 18:00Z onward belong to the next Dhaka day; see `day.ts` and `tests/timezone-boundaries.test.ts` |
| `cached` | `true` when this response was served from the in-memory cache |

The mock provider is **fully deterministic**: all temperature/rain values derive
from latitude and a fixed reference instant (`MOCK_REFERENCE_NOW`), so tests can
assert exact timestamps/dates. It is fixture data and is labelled as such in the
production placeholder manifest.

## Cache contract (A5-05)

- Key: location rounded to 2 decimals — `` `${lat.toFixed(2)},${lng.toFixed(2)}` ``
  (farms within ~1 km share one provider call).
- TTL: `WEATHER_CACHE_TTL_SECONDS` (default 600 s; **0 disables caching**
  entirely — no reads, no writes).
- Stored: the successful `{ current, forecast }` payload plus its fetch time.
  Cache hits keep the original `fetchedAt` and set `cached: true`.
- **Failures are never cached, and cache entries are never served as a fallback
  for a failed refresh.** An outage surfaces as an error, not as stale "current"
  weather presented as fresh — a spray decision must not be made on yesterday's
  wind. (Provider failures currently surface as a generic 500; a typed 502/503
  mapping is tracked as AUD-117.)
- The cache is per-process in-memory (no Redis): multi-instance deployments may
  fetch once per instance. `clearWeatherCache()` is exported for tests.
