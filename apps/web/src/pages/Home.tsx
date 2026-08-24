import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";

interface FarmShape {
  id: string;
  name: string;
  plots: { id: string; cropCycles: { id: string; cropName: string; stage: string }[] }[];
}
interface WeatherShape {
  current: { tempC: number; humidityPct: number; windKmh: number; condition: string };
  risks: { type: string; severity: string; titleBn: string; titleEn: string; detailEn: string }[];
}

const SEVERITY_STYLES: Record<string, string> = {
  HIGH: "bg-red-100 text-red-800",
  MODERATE: "bg-amber-100 text-amber-800",
  LOW: "bg-green-100 text-green-800",
};

export default function Home() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const [farms, setFarms] = useState<FarmShape[]>([]);
  const [weather, setWeather] = useState<WeatherShape | null>(null);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [farmsData, notif] = await Promise.all([
          api<FarmShape[]>("GET", "/farms"),
          api<{ unread: number }>("GET", "/notifications"),
        ]);
        setFarms(farmsData);
        setUnread(notif.unread);

        const profile = await api<{ farmerProfile?: { district?: string } }>("GET", "/auth/me");
        void profile;
        // Use demo farm coordinates when the farm has none (mock provider is location-insensitive).
        const farm = farmsData[0];
        if (farm) {
          const w = await api<WeatherShape>("GET", `/weather?lat=25.9&lng=89.1`);
          setWeather(w);
        }
      } catch {
        setError(true);
      }
    })();
  }, []);

  const activeCrops = farms.flatMap((f) => f.plots.flatMap((p) => p.cropCycles));

  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-xl font-bold text-stone-800">আসসালামু আলাইকুম, {session?.fullName} 👋</h1>
        <p className="text-sm text-stone-500">{t("tagline", lang)}</p>
      </section>

      {error && <p className="card bg-red-50 text-sm text-red-700">{t("errorGeneric", lang)}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Weather card */}
        <div className="card">
          <h2 className="mb-2 font-semibold text-stone-700">🌦️ {t("weather", lang)}</h2>
          {weather ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-green-800">{weather.current.tempC}°</span>
                <span className="text-sm text-stone-500">{weather.current.condition}</span>
              </div>
              <p className="mt-1 text-xs text-stone-400">আর্দ্রতা {weather.current.humidityPct}% · বাতাস {weather.current.windKmh} km/h</p>
              <div className="mt-3 space-y-2">
                {weather.risks.map((r, i) => (
                  <div key={i} className={`rounded-lg p-2 text-xs ${SEVERITY_STYLES[r.severity] ?? "bg-stone-100"}`}>
                    <span className="font-semibold">{lang === "bn" ? r.titleBn : r.titleEn}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-stone-400">{t("loading", lang)}</p>
          )}
        </div>

        {/* Active crops */}
        <div className="card">
          <h2 className="mb-2 font-semibold text-stone-700">🌱 চলমান ফসল</h2>
          {activeCrops.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {activeCrops.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-lg bg-green-50 px-3 py-2">
                  <span className="font-medium">{c.cropName}</span>
                  <span className="badge bg-green-200 text-green-900">{c.stage}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone-400">
              কোনো ফসল নেই। <Link to="/farm" className="font-semibold text-green-700 hover:underline">{t("myFarm", lang)} →</Link>
            </p>
          )}
        </div>

        {/* Quick actions */}
        <div className="card flex flex-col gap-2">
          <h2 className="mb-1 font-semibold text-stone-700">⚡ দ্রুত সেবা</h2>
          <Link to="/advisor" className="btn-outline w-full">🤖 {t("aiAgent", lang)}</Link>
          <Link to="/services" className="btn-outline w-full">🚜 {t("services", lang)}</Link>
          <Link to="/sell" className="btn-outline w-full">💰 {t("sellCrop", lang)}</Link>
          <Link to="/wallet" className="btn-outline w-full">👛 {t("wallet", lang)}</Link>
          <Link to="/notifications" className="relative btn-outline w-full">
            🔔 {t("notifications", lang)}
            {unread > 0 && (
              <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{unread}</span>
            )}
          </Link>
        </div>
      </div>
    </div>
  );
}
