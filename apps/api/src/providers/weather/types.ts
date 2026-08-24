export interface CurrentWeather {
  tempC: number;
  feelsLikeC: number;
  humidityPct: number;
  windKmh: number;
  precipitationMm: number;
  condition: string;
}

export interface DailyForecast {
  date: string;
  minC: number;
  maxC: number;
  rainMm: number;
  humidityPct: number;
  windKmh: number;
}

export interface WeatherProvider {
  readonly name: string;
  getCurrent(lat: number, lng: number): Promise<CurrentWeather>;
  getForecast(lat: number, lng: number, days: number): Promise<DailyForecast[]>;
}

export interface AgriRisk {
  type: "SPRAY_WARNING" | "RAIN_WARNING" | "HEAT_WARNING" | "IRRIGATION_ADVICE" | "DISEASE_RISK" | "INFO";
  severity: "LOW" | "MODERATE" | "HIGH";
  titleBn: string;
  titleEn: string;
  detailEn: string;
}

/**
 * Weather -> agricultural decision support (Section 15).
 * Converts raw weather + crop stage into actionable risks.
 */
export function deriveAgriRisks(current: CurrentWeather, forecast: DailyForecast[], cropStage?: string): AgriRisk[] {
  const risks: AgriRisk[] = [];

  if (current.windKmh > 15) {
    risks.push({
      type: "SPRAY_WARNING",
      severity: current.windKmh > 25 ? "HIGH" : "MODERATE",
      titleBn: "স্প্রে করা ঝুঁকিপূর্ণ",
      titleEn: "Spraying not advised",
      detailEn: `Wind is ${current.windKmh.toFixed(0)} km/h. Spray drift will reduce effectiveness and may damage neighbouring crops. Wait for calmer conditions (below 15 km/h).`,
    });
  }

  const rainToday = forecast[0];
  if (rainToday && rainToday.rainMm > 10) {
    risks.push({
      type: "RAIN_WARNING",
      severity: rainToday.rainMm > 30 ? "HIGH" : "MODERATE",
      titleBn: "ভারী বর্ষণের সতর্কতা",
      titleEn: "Heavy rainfall expected",
      detailEn: `${rainToday.rainMm.toFixed(0)} mm rain expected today. Delay fertilizer/pesticide application; ensure field drainage.`,
    });
  }

  if (current.tempC >= 35) {
    risks.push({
      type: "HEAT_WARNING",
      severity: "HIGH",
      titleBn: "তাপপ্রবাহের সতর্কতা",
      titleEn: "Heat stress risk",
      detailEn: `Temperature is ${current.tempC.toFixed(0)}°C. Irrigate in early morning or evening; avoid midday field work for crops in ${cropStage ?? "active"} stage.`,
    });
  }

  if (rainToday && rainToday.rainMm < 2 && !forecast.slice(0, 3).some((f) => f.rainMm > 5)) {
    risks.push({
      type: "IRRIGATION_ADVICE",
      severity: "MODERATE",
      titleBn: "সেচের পরামর্শ",
      titleEn: "Irrigation recommended",
      detailEn: "No meaningful rainfall in the next 3 days and soil moisture will decline. Plan irrigation within 48 hours.",
    });
  }

  if (current.humidityPct > 85 && current.tempC >= 20 && current.tempC <= 30) {
    risks.push({
      type: "DISEASE_RISK",
      severity: "HIGH",
      titleBn: "ছত্রাকজনিত রোগের ঝুঁকি",
      titleEn: "Fungal disease risk high",
      detailEn: "Humidity above 85% with warm temperature favours blight/rust. Scout fields and consider preventive fungicide only after confirming via disease detection or an agronomist.",
    });
  }

  if (risks.length === 0) {
    risks.push({
      type: "INFO",
      severity: "LOW",
      titleBn: "আবহাওয়া অনুকূল",
      titleEn: "Conditions favourable",
      detailEn: "No weather-driven risks detected for the next 24 hours.",
    });
  }

  return risks;
}
