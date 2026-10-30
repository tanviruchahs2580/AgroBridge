import { describe, expect, it } from "vitest";
import { deriveAgriRisks, type AgriRisk, type CurrentWeather, type DailyForecast } from "../src/providers/weather/types.js";

/**
 * A5-02 / A5-04 — weather → advisory rules and the safety of what they say.
 *
 * The rules are plain thresholds over explicit fields; these tests pin the
 * boundaries (so a drifting `>`/`>=` is caught) and then sweep the advice copy
 * itself for the A5-04 properties: uncertainty language present, no guarantee
 * phrasing, no chemical dosage or product instruction — ever.
 */

const cur = (over: Partial<CurrentWeather> = {}): CurrentWeather => ({
  tempC: 28,
  feelsLikeC: 30,
  humidityPct: 70,
  windKmh: 5,
  precipitationMm: 0,
  condition: "clear sky",
  ...over,
});

const day = (over: Partial<DailyForecast> = {}): DailyForecast => ({
  date: "2026-06-15",
  minC: 26,
  maxC: 33,
  rainMm: 0,
  humidityPct: 70,
  windKmh: 5,
  ...over,
});

const has = (risks: AgriRisk[], type: AgriRisk["type"]) => risks.some((r) => r.type === type);

describe("weather → advisory rules: thresholds are explicit and boundary-tested (A5-02)", () => {
  it("spray warning starts above 15 km/h and escalates to HIGH above 25 km/h", () => {
    expect(has(deriveAgriRisks(cur({ windKmh: 15 }), [day({ rainMm: 5 })]), "SPRAY_WARNING")).toBe(false);
    const at16 = deriveAgriRisks(cur({ windKmh: 16 }), [day({ rainMm: 5 })]);
    expect(at16.find((r) => r.type === "SPRAY_WARNING")?.severity).toBe("MODERATE");
    const at26 = deriveAgriRisks(cur({ windKmh: 26 }), [day({ rainMm: 5 })]);
    expect(at26.find((r) => r.type === "SPRAY_WARNING")?.severity).toBe("HIGH");
  });

  it("rain warning starts above 10 mm today and escalates above 30 mm", () => {
    expect(has(deriveAgriRisks(cur(), [day({ rainMm: 10 })]), "RAIN_WARNING")).toBe(false);
    expect(deriveAgriRisks(cur(), [day({ rainMm: 11 })]).find((r) => r.type === "RAIN_WARNING")?.severity).toBe("MODERATE");
    expect(deriveAgriRisks(cur(), [day({ rainMm: 31 })]).find((r) => r.type === "RAIN_WARNING")?.severity).toBe("HIGH");
  });

  it("heat warning starts at 35 °C and is always HIGH", () => {
    expect(has(deriveAgriRisks(cur({ tempC: 34.9 }), [day({ rainMm: 5 })]), "HEAT_WARNING")).toBe(false);
    expect(deriveAgriRisks(cur({ tempC: 35 }), [day({ rainMm: 5 })]).find((r) => r.type === "HEAT_WARNING")?.severity).toBe("HIGH");
  });

  it("irrigation advice needs a dry today (<2 mm) AND a dry 3-day window", () => {
    expect(has(deriveAgriRisks(cur(), [day({ rainMm: 2 })]), "IRRIGATION_ADVICE")).toBe(false);
    expect(has(deriveAgriRisks(cur(), [day({ rainMm: 0 }), day({ rainMm: 6 })]), "IRRIGATION_ADVICE")).toBe(false);
    expect(has(deriveAgriRisks(cur(), [day({ rainMm: 1 }), day({ rainMm: 5 })]), "IRRIGATION_ADVICE")).toBe(true);
  });

  it("disease risk needs humidity >85% inside the 20–30 °C band", () => {
    expect(has(deriveAgriRisks(cur({ humidityPct: 85, tempC: 25 }), [day({ rainMm: 5 })]), "DISEASE_RISK")).toBe(false);
    expect(has(deriveAgriRisks(cur({ humidityPct: 86, tempC: 29.9 }), [day({ rainMm: 5 })]), "DISEASE_RISK")).toBe(true);
    expect(has(deriveAgriRisks(cur({ humidityPct: 90, tempC: 31 }), [day({ rainMm: 5 })]), "DISEASE_RISK")).toBe(false);
  });

  it("falls back to a single INFO advisory when nothing applies — never an empty list", () => {
    const quiet = deriveAgriRisks(cur({ windKmh: 3, tempC: 28, humidityPct: 60 }), [day({ rainMm: 5 })]);
    expect(quiet).toHaveLength(1);
    expect(quiet[0]?.type).toBe("INFO");
    expect(quiet[0]?.severity).toBe("LOW");
  });
});

describe("advisory copy: uncertain, never a guarantee, never a dosage (A5-04)", () => {
  /** Every advisory the rules can emit, provoked together where possible. */
  const ADVERSE: AgriRisk[] = deriveAgriRisks(
    { tempC: 36, feelsLikeC: 40, humidityPct: 90, windKmh: 27, precipitationMm: 0, condition: "haze" },
    [day({ rainMm: 0 }), day({ rainMm: 0 }), day({ rainMm: 1 })],
    "flowering",
  );
  const RAINY: AgriRisk[] = deriveAgriRisks(cur({ humidityPct: 88, tempC: 26, windKmh: 4 }), [day({ rainMm: 35 })]);
  const ALL = [...ADVERSE, ...RAINY];

  it("provokes all four action types so the sweep below is not vacuous", () => {
    for (const t of ["SPRAY_WARNING", "RAIN_WARNING", "HEAT_WARNING", "IRRIGATION_ADVICE", "DISEASE_RISK"] as const) {
      expect(has(ALL, t), `${t} was not provoked`).toBe(true);
    }
  });

  it("carries no chemical dosage, product name or application rate in any advisory copy", () => {
    for (const r of ALL) {
      const text = `${r.titleEn} ${r.detailEn}`;
      // No numbers-with-units (a rate), no dosing words, no named actives.
      expect(text, r.type).not.toMatch(/\d+\s*(ml|ml\/|l\b|litre|liter|kg|gm|gram|g\/|per\s+(bigha|acre|hectare))/i);
      expect(text, r.type).not.toMatch(/\b(dose|dosage|apply\s+\d|mix\s+\d|ml per)\b/i);
    }
  });

  it("never guarantees an outcome", () => {
    const GUARANTEE = /guarantee[ds]?|assured|100%|will certainly|no risk at all|will definitely/i;
    for (const r of ALL) {
      expect(`${r.titleEn} ${r.detailEn}`, r.type).not.toMatch(GUARANTEE);
    }
  });

  it("every action-type advisory uses uncertainty/conditional language", () => {
    // One of: expected/risk/advised/consider/may/decline/plan/recommended —
    // i.e. the sentence is framed as a forecast or a suggestion, not a fact.
    const UNCERTAIN = /expect|risk|not advised|consider|may |decline|plan |recommend|favour|scout/i;
    for (const r of ALL.filter((x) => x.type !== "INFO")) {
      expect(`${r.titleEn} ${r.detailEn}`, r.type).toMatch(UNCERTAIN);
    }
  });

  it("chemical-adjacent advice is conditional on confirmation: the disease-risk advisory tells the farmer to confirm before any treatment", () => {
    const disease = ALL.find((r) => r.type === "DISEASE_RISK");
    expect(disease?.detailEn).toMatch(/only after confirming/i);
    expect(disease?.detailEn).toMatch(/agronomist|disease detection/i);
  });
});
