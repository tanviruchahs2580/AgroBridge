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
  const [walletBal, setWalletBal] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [tasks, setTasks] = useState<{ id: string; label: string; done: boolean }[]>([
    { id: "t1", label: lang === "bn" ? "জমিতে পানি পরীক্ষা করুন" : "Check field water level", done: false },
    { id: "t2", label: lang === "bn" ? "সার প্রয়োগের সময় যাচাই করুন" : "Verify fertilizer schedule", done: false },
    { id: "t3", label: lang === "bn" ? "পোকা/রোগ পর্যবেক্ষণ" : "Scout for pests/disease", done: false },
  ]);

  useEffect(() => {
    (async () => {
      try {
        const [farmsData, notif] = await Promise.all([
          api<FarmShape[]>("GET", "/farms"),
          api<{ unread: number }>("GET", "/notifications"),
        ]);
        setFarms(farmsData);
        setUnread(notif.unread);
        try {
          const w = await api<{ balancePaisa: number }>("GET", "/wallet");
          setWalletBal(w.balancePaisa);
        } catch { /* wallet may be empty */ }

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
  const todayStr = new Date().toLocaleDateString(lang === "bn" ? "bn-BD" : "en-BD", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-xl font-bold text-stone-800">আসসালামু আলাইকুম, {session?.fullName} 👋</h1>
        <p className="text-sm text-stone-500">{todayStr} · {t("tagline", lang)}</p>
      </section>

      {error && <p className="card bg-red-50 text-sm text-red-700">{t("errorGeneric", lang)}</p>}

      {/* Decision-first: Today's tasks */}
      <div className="card">
        <h2 className="mb-3 font-semibold text-stone-700">✅ {lang === "bn" ? "আজকের কাজ" : "Today's tasks"}</h2>
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={task.done}
                onChange={() => setTasks((prev) => prev.map((p) => (p.id === task.id ? { ...p, done: !p.done } : p)))}
                className="h-4 w-4 rounded border-stone-300 text-green-700 focus:ring-green-600"
                aria-label={task.label}
              />
              <span className={`text-sm ${task.done ? "text-stone-400 line-through" : "text-stone-700"}`}>{task.label}</span>
            </li>
          ))}
        </ul>
        {activeCrops.length === 0 && (
          <p className="mt-3 text-xs text-stone-500">
            {lang === "bn" ? "প্রথম ফসল যোগ করলে কাজগুলো স্বয়ংক্রিয় হবে।" : "Add your first crop to auto-generate tasks."} <Link to="/farm" className="font-semibold text-green-700 hover:underline">{t("myFarm", lang)} →</Link>
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Weather card with action pairing */}
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
                    <span className="ml-1 text-[11px] opacity-80">{r.severity === "HIGH" ? (lang === "bn" ? "→ আজ স্প্রে স্থগিত করুন" : "→ postpone spray") : ""}</span>
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

        {/* Wallet teaser */}
        <div className="card">
          <h2 className="mb-2 font-semibold text-stone-700">👛 {t("wallet", lang)}</h2>
          <p className="text-2xl font-bold text-green-800">{walletBal !== null ? `৳${(walletBal / 100).toLocaleString("bn-BD")}` : "—"}</p>
          <p className="text-xs text-stone-500">{lang === "bn" ? "উপলব্ধ ব্যালেন্স" : "Available balance"}</p>
          <Link to="/wallet" className="btn-outline mt-3 w-full text-center">{t("wallet", lang)} →</Link>
        </div>

        {/* Quick actions */}
        <div className="card flex flex-col gap-2 sm:col-span-2 lg:col-span-3">
          <h2 className="mb-1 font-semibold text-stone-700">⚡ দ্রুত সেবা</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Link to="/advisor" className="btn-outline w-full">🤖 {t("aiAgent", lang)}</Link>
            <Link to="/services" className="btn-outline w-full">🚜 {t("services", lang)}</Link>
            <Link to="/sell" className="btn-outline w-full">💰 {t("sellCrop", lang)}</Link>
            <Link to="/notifications" className="relative btn-outline w-full">
              🔔 {t("notifications", lang)}
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{unread}</span>
              )}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
