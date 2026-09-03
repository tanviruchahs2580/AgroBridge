import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";
import type { DictKey } from "../lib/i18n.js";
import { formatBDT } from "../lib/format.js";
import { stageLabel, weatherRiskActionLabel } from "../lib/labels.js";
import { Button, ErrorBanner, Skeleton } from "../components/ui.jsx";

interface FarmShape {
  id: string;
  name: string;
  plots: { id: string; cropCycles: { id: string; cropName: string; stage: string }[] }[];
}
interface WeatherShape {
  current: { tempC: number; humidityPct: number; windKmh: number; condition: string };
  risks: { type: string; severity: string; titleBn: string; titleEn: string }[];
}

const TASK_KEYS: { id: string; key: DictKey }[] = [
  { id: "t1", key: "taskMorningIrrigation" },
  { id: "t2", key: "taskWeedClean" },
  { id: "t3", key: "taskFertilizerCheck" },
  { id: "t4", key: "taskCropMonitor" },
];

const RICE_IMG = "https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?auto=format&fit=crop&w=300&q=80";
const FARM_HERO_IMG = "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80";

function HealthRing({ score }: { score: number }) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const off = c - (score / 100) * c;
  return (
    <div className="relative flex h-[92px] w-[92px] items-center justify-center">
      <svg width="92" height="92" viewBox="0 0 92 92" className="-rotate-90" aria-hidden>
        <circle cx="46" cy="46" r={r} stroke="rgba(255,255,255,0.18)" strokeWidth="7" fill="none" />
        <circle cx="46" cy="46" r={r} stroke="#22c55e" strokeWidth="7" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} className="drop-shadow-sm transition-all duration-700" />
      </svg>
      <span className="absolute text-[22px] font-extrabold text-white">{score}%</span>
    </div>
  );
}

export default function Home() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const [farms, setFarms] = useState<FarmShape[]>([]);
  const [weather, setWeather] = useState<WeatherShape | null>(null);
  const [unread, setUnread] = useState(0);
  const [walletBal, setWalletBal] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [tasks, setTasks] = useState<Record<string, boolean>>({ t1: true, t2: false, t3: false, t4: false });

  async function load() {
    setError(false);
    setLoaded(false);
    try {
      const [farmsData, notif, walletData, weatherData] = await Promise.allSettled([
        api<FarmShape[]>("GET", "/farms"),
        api<{ unread: number }>("GET", "/notifications"),
        api<{ balancePaisa: number }>("GET", "/wallet"),
        api<WeatherShape>("GET", "/weather?lat=25.9&lng=89.1"),
      ]);
      if (farmsData.status === "fulfilled") setFarms(farmsData.value);
      if (notif.status === "fulfilled") setUnread(notif.value.unread);
      if (walletData.status === "fulfilled") setWalletBal(walletData.value.balancePaisa);
      if (weatherData.status === "fulfilled") setWeather(weatherData.value);
      if (farmsData.status === "rejected") throw farmsData.reason;
      setLoaded(true);
    } catch {
      setError(true);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cropCycles = farms.flatMap((f) => f.plots.flatMap((p) => p.cropCycles));
  const primaryCrop = cropCycles[0];
  const healthScore = farms.length > 0 ? 87 : 72;
  const todayBn = new Intl.DateTimeFormat("bn-BD", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const todayEn = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());

  return (
    <div className="min-w-0 space-y-5 overflow-hidden">
      {/* Greeting */}
      <section className="animate-enterprise px-1" style={{ animationDelay: "0ms" } as React.CSSProperties}>
        <h1 className="text-[17px] font-bold leading-tight text-stone-800 sm:text-xl">
          {t("greeting", lang, { name: session?.fullName ?? "" })}
        </h1>
        <p className="mt-1 flex items-center gap-1.5 text-[13px] text-stone-600">
          <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center rounded-sm border border-stone-300 bg-white text-[10px]">📅</span>
          {lang === "bn" ? todayBn : todayEn}
        </p>
      </section>

      {error && (
        <div className="animate-enterprise space-y-2 px-1" style={{ animationDelay: "60ms" } as React.CSSProperties}>
          <ErrorBanner message={t("errorGeneric", lang)} />
          <Button variant="outline" onClick={() => void load()}>{t("retry", lang)}</Button>
        </div>
      )}

      {/* AI Farm Status — enterprise hero, realistic photographic */}
      <section className="animate-enterprise relative overflow-hidden rounded-2xl shadow-sm" style={{ animationDelay: "80ms" } as React.CSSProperties}>
        <img src={FARM_HERO_IMG} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" loading="eager" />
        <div className="absolute inset-0 bg-gradient-to-br from-[#0f172a]/95 via-[#14532d]/85 to-[#14532d]/75" aria-hidden />
        <div className="absolute inset-0 bg-[radial-gradient(600px_200px_at_90%_20%,rgba(34,197,94,0.18),transparent_60%)]" aria-hidden />
        <div className="relative flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-emerald-100 ring-1 ring-white/15">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden /> AI • {t("healthScore", lang)}
            </p>
            <h2 className="mt-2 text-[18px] font-extrabold leading-tight text-white sm:text-[20px]">{t("aiFarmHealthy", lang)}</h2>
            <p className="mt-1 max-w-[36ch] text-[13px] leading-relaxed text-emerald-50/90">
              {lang === "bn" ? "এআই বিশ্লেষণে আপনার জমি, ফসল ও আবহাওয়া অনুকূল পর্যায়ে আছে।" : "AI analysis shows your soil, crops and weather are in favorable condition."}
            </p>
            <Link to="/farm" className="mt-3 inline-flex min-h-[36px] items-center rounded-lg bg-white px-3.5 py-1.5 text-[13px] font-bold text-[#14532d] shadow-sm hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
              {t("viewDetails", lang)} <span aria-hidden className="ml-1">→</span>
            </Link>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-2 self-center rounded-2xl bg-white/10 p-3 ring-1 ring-white/15 backdrop-blur sm:self-auto">
            <HealthRing score={healthScore} />
            <span className="text-[11px] font-medium tracking-wide text-emerald-100">{healthScore}% • {lang === "bn" ? "সক্রিয়" : "Active"}</span>
          </div>
        </div>
      </section>

      {/* 4-card grid — image-matched */}
      <section className="animate-enterprise grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" style={{ animationDelay: "140ms" } as React.CSSProperties}>
        {/* আজকের কাজ */}
        <div className="rounded-2xl border border-[#dcfce7] bg-[#f0fdf4] p-3 shadow-sm transition hover:shadow-md">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#15803d] text-white shadow-sm" aria-hidden>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
            </span>
            <h2 className="text-[15px] font-bold text-stone-800">{t("todayTasks", lang)}</h2>
          </div>
          <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-black/5">
            <ul className="divide-y divide-stone-100">
              {TASK_KEYS.map((task) => {
                const checked = tasks[task.id] ?? false;
                return (
                  <li key={task.id} className="flex items-center gap-3 py-2.5 first:pt-1 last:pb-1">
                    <button type="button" role="checkbox" aria-checked={checked} aria-label={t(task.key, lang)} onClick={() => setTasks((p) => ({ ...p, [task.id]: !p[task.id] }))} className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2 ${checked ? "border-[#16a34a] bg-[#16a34a] text-white" : "border-stone-300 bg-white"}`}>
                      {checked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>}
                    </button>
                    <span className={`min-w-0 flex-1 text-[13px] leading-tight ${checked ? "font-medium text-green-700" : "text-stone-700"}`}>{t(task.key, lang)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <Link to="/farm" className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg py-2 text-[13px] font-semibold text-[#15803d] hover:bg-white/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600">
            {t("viewAllTasks", lang)} <span aria-hidden>→</span>
          </Link>
        </div>

        {/* আবহাওয়া */}
        <div className="flex flex-col overflow-hidden rounded-2xl border border-[#dbeafe] bg-[#f0f7ff] shadow-sm transition hover:shadow-md">
          <div className="flex-1 p-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-[15px] font-bold text-[#1e3a5f]">{t("weather", lang)}</h2>
              <span aria-hidden className="text-2xl leading-none drop-shadow-sm">⛅</span>
            </div>
            {!loaded && !weather ? (
              <div className="mt-3 space-y-2"><Skeleton className="h-10 w-28" /><Skeleton className="h-4 w-32" /></div>
            ) : weather ? (
              <>
                <div className="mt-1 flex items-baseline gap-1"><span className="text-[42px] font-extrabold leading-none tracking-tight text-[#1e293b]">{weather.current.tempC}°</span></div>
                <p className="text-[13px] text-stone-600">Partly cloudy</p>
                <div className="mt-4 flex items-center gap-6 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="text-sky-600">💧</span>
                    <span className="flex flex-col leading-none"><span className="text-[11px] font-medium text-stone-600">{t("humidityLabel", lang)}</span><span className="text-[13px] font-semibold text-stone-700">{weather.current.humidityPct}%</span></span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden className="text-sky-600">≋</span>
                    <span className="flex flex-col leading-none"><span className="text-[11px] font-medium text-stone-600">{t("windLabel", lang)}</span><span className="text-[13px] font-semibold text-stone-700">{weather.current.windKmh} km/h</span></span>
                  </span>
                </div>
              </>
            ) : <p className="mt-3 text-sm text-stone-500">—</p>}
          </div>
          <div className="flex items-start gap-2 rounded-b-2xl bg-[#dcfce7]/60 px-3 py-2.5">
            <span aria-hidden className="mt-0.5 text-green-700">🌿</span>
            <div className="min-w-0">
              <p className="text-[12px] font-semibold leading-tight text-green-800">{weather && weather.risks.length > 0 ? (lang === "bn" ? weather.risks[0].titleBn : weather.risks[0].titleEn) : t("weatherFavorable", lang)} <span aria-hidden>→</span></p>
              <p className="text-[11px] leading-tight text-stone-600">{weather && weather.risks.length > 0 ? (weatherRiskActionLabel(weather.risks[0].type, lang) ?? t("regularFarmVisit", lang)) : t("regularFarmVisit", lang)}</p>
            </div>
          </div>
        </div>

        {/* চলমান ফসল */}
        <div className="rounded-2xl border border-[#dcfce7] bg-[#f0fdf4] p-4 text-center shadow-sm transition hover:shadow-md">
          <h2 className="flex items-center justify-center gap-1.5 text-[15px] font-bold text-stone-800"><span aria-hidden className="text-green-600">🌿</span> {t("activeCropsTitle", lang)}</h2>
          <div className="mx-auto mt-4 flex h-[92px] w-[92px] items-center justify-center overflow-hidden rounded-full border-2 border-[#86efac] bg-white shadow-sm">
            <img src={RICE_IMG} alt="" className="h-full w-full object-cover" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
          </div>
          <p className="mt-3 text-[16px] font-bold text-[#14532d]">{primaryCrop ? primaryCrop.cropName : lang === "bn" ? "ধান" : "Rice"}</p>
          <span className="mt-2 inline-flex items-center rounded-full bg-[#dcfce7] px-3 py-1 text-[11px] font-semibold text-green-800">{primaryCrop ? stageLabel(primaryCrop.stage, lang) : t("growthStage", lang)}</span>
          <Link to="/farm" className="mt-4 flex w-full items-center justify-center gap-1 text-[13px] font-semibold text-[#15803d] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600">{t("viewDetails", lang)} <span aria-hidden>→</span></Link>
        </div>

        {/* ওয়ালেট */}
        <div className="rounded-2xl border border-[#fde68a] bg-[#fffbeb] p-4 text-center shadow-sm transition hover:shadow-md">
          <h2 className="flex items-center justify-center gap-1.5 text-[15px] font-bold text-stone-800"><span aria-hidden className="text-amber-600">👛</span> {t("wallet", lang)}</h2>
          <div className="mt-6">
            {walletBal !== null ? <p className="text-[28px] font-extrabold tracking-tight text-[#14532d]">{formatBDT(walletBal, lang)}</p> : loaded ? <p className="text-[28px] font-extrabold text-stone-300">—</p> : <Skeleton className="mx-auto h-8 w-28" />}
            <p className="mt-1 text-[12px] text-stone-600">{t("availableBalance", lang)}</p>
          </div>
          <Link to="/wallet" className="mt-8 flex w-full items-center justify-center gap-1 text-[13px] font-semibold text-[#15803d] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600">{t("viewTransactions", lang)} <span aria-hidden>→</span></Link>
        </div>
      </section>

      {/* AI Assistant Entry — premium large prompt */}
      <section className="animate-enterprise relative overflow-hidden rounded-2xl border border-[#e0e7ff] bg-gradient-to-br from-[#eef2ff] via-white to-[#f0fdf4] p-4 shadow-sm" style={{ animationDelay: "180ms" } as React.CSSProperties}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 rounded-full bg-[#4f46e5] px-2.5 py-1 text-[11px] font-bold tracking-wide text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden /> AI • AgroBridge
            </p>
            <h2 className="mt-2 text-[16px] font-extrabold text-stone-800">{t("aiAskTitle", lang)}</h2>
            <p className="text-[13px] text-stone-600">{t("aiAskSubtitle", lang)}</p>
          </div>
          <Link to="/advisor" className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl bg-[#4f46e5] px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-[#4338ca] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f46e5]">
            {lang === "bn" ? "প্রশ্ন করুন" : "Ask now"} <span aria-hidden className="ml-1">→</span>
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[["aiActionDiagnose", "🩺"], ["aiActionPlant", "🌱"], ["aiActionFertilizer", "🧪"], ["aiActionWeather", "⛅"]] .map(([k, icon]) => (
            <Link key={k} to="/advisor" className="flex items-center gap-2 rounded-xl border border-[#e0e7ff] bg-white px-3 py-2.5 text-[12px] font-semibold text-stone-700 shadow-sm hover:border-[#c7d2fe] hover:bg-[#eef2ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f46e5]">
              <span aria-hidden>{icon as string}</span> {t(k as DictKey, lang)}
            </Link>
          ))}
        </div>
      </section>

      {/* দ্রুত সেবা */}
      <section className="animate-enterprise" style={{ animationDelay: "220ms" } as React.CSSProperties}>
        <h2 className="mb-3 px-1 text-[16px] font-bold text-stone-800">{t("quickActions", lang)}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Link to="/advisor" className="flex items-center gap-3 rounded-2xl border border-[#bbf7d0] bg-[#f0fdf4] p-3 shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#dcfce7] text-xl" aria-hidden>🤖</span>
            <span className="min-w-0"><span className="block text-[13px] font-bold leading-tight text-stone-800">{t("aiAgent", lang)}</span><span className="block text-[11px] leading-tight text-stone-600">{t("quickAiSub", lang)}</span></span>
          </Link>
          <Link to="/services" className="flex items-center gap-3 rounded-2xl border border-[#bfdbfe] bg-[#eff6ff] p-3 shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#dbeafe] text-xl" aria-hidden>🚜</span>
            <span className="min-w-0"><span className="block text-[13px] font-bold leading-tight text-stone-800">{t("services", lang)}</span><span className="block text-[11px] leading-tight text-stone-600">{t("quickServiceSub", lang)}</span></span>
          </Link>
          <Link to="/sell" className="flex items-center gap-3 rounded-2xl border border-[#e9d5ff] bg-[#faf5ff] p-3 shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#f3e8ff] text-xl" aria-hidden>🧺</span>
            <span className="min-w-0"><span className="block text-[13px] font-bold leading-tight text-[#581c87]">{t("sellCrop", lang)}</span><span className="block text-[11px] leading-tight text-stone-600">{t("quickSellSub", lang)}</span></span>
          </Link>
          <Link to="/notifications" className="relative flex items-center gap-3 rounded-2xl border border-[#fecaca] bg-[#fef2f2] p-3 shadow-sm transition hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#fee2e2] text-xl" aria-hidden>🔔</span>
            <span className="min-w-0"><span className="block text-[13px] font-bold leading-tight text-stone-800">{t("notifications", lang)}</span><span className="block text-[11px] leading-tight text-stone-600">{t("quickNotifSub", lang)}</span></span>
            {unread > 0 && <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-[11px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
          </Link>
        </div>
      </section>

      {/* Smart Alerts — enterprise ops */}
      <section className="animate-enterprise rounded-2xl border border-stone-200 bg-white p-4 shadow-sm" style={{ animationDelay: "260ms" } as React.CSSProperties}>
        <h2 className="flex items-center gap-2 text-[14px] font-bold text-stone-800"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-amber-700" aria-hidden>⚠</span> {t("alertsTitle", lang)}</h2>
        <ul className="mt-3 space-y-2">
          <li className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">
            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
            <span className="text-[12px] leading-relaxed text-stone-700">{t("alertRain", lang)}</span>
          </li>
          <li className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2.5">
            <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" aria-hidden />
            <span className="text-[12px] leading-relaxed text-stone-700">{t("alertPest", lang)}</span>
          </li>
        </ul>
      </section>
    </div>
  );
}
