import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Bell, Bot, Calendar, CheckSquare, CloudSun, Coins, Droplets, FlaskConical, Leaf,
  Sprout, Stethoscope, Tractor, TriangleAlert, Wallet, Wind,
} from "lucide-react";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { t } from "../../lib/i18n";
import type { DictKey } from "../../lib/i18n";
import { formatBDT } from "../../lib/format";
import { stageLabel, weatherConditionLabel, weatherRiskActionLabel } from "../../lib/labels";
import { Button, ErrorBanner, Skeleton } from "../../components/ui";

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

/**
 * Farm readiness derived from the data actually loaded on this screen
 * (farms, active crop cycles, weather risks) — replaces the v1 hardcoded 87/72.
 * Only actionable risks (non-INFO, non-LOW) count against the score.
 */
function actionableRisks(weather: WeatherShape | null) {
  return weather ? weather.risks.filter((r) => r.type !== "INFO" && r.severity !== "LOW") : [];
}

function computeHealthScore(farms: FarmShape[], weather: WeatherShape | null): number {
  const cycles = farms.flatMap((f) => f.plots.flatMap((p) => p.cropCycles));
  const risks = actionableRisks(weather).length;
  let score = 60;
  if (farms.length > 0) score += 12;
  if (cycles.length > 0) score += 12;
  if (weather) score += risks === 0 ? 10 : Math.max(0, 6 - risks * 3);
  return Math.min(96, score);
}

function HealthRing({ score }: { score: number }) {
  const r = 36;
  const c = 2 * Math.PI * r;
  const off = c - (score / 100) * c;
  return (
    <div className="relative flex h-[92px] w-[92px] items-center justify-center">
      <svg width="92" height="92" viewBox="0 0 92 92" className="-rotate-90" aria-hidden>
        <circle cx="46" cy="46" r={r} stroke="rgba(255,255,255,0.18)" strokeWidth="7" fill="none" />
        <circle cx="46" cy="46" r={r} stroke="var(--color-brand-400)" strokeWidth="7" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} className="drop-shadow-sm transition-all duration-700" />
      </svg>
      <span className="absolute text-[22px] font-extrabold text-white">{score}%</span>
    </div>
  );
}

const AI_ACTIONS: { key: DictKey; icon: typeof Bot }[] = [
  { key: "aiActionDiagnose", icon: Stethoscope },
  { key: "aiActionPlant", icon: Sprout },
  { key: "aiActionFertilizer", icon: FlaskConical },
  { key: "aiActionWeather", icon: CloudSun },
];

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
  const healthScore = computeHealthScore(farms, weather);
  const hasRisk = actionableRisks(weather).length > 0;
  const todayBn = new Intl.DateTimeFormat("bn-BD", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const todayEn = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());

  return (
    <div className="min-w-0 space-y-5 overflow-hidden">
      {/* Greeting */}
      <section className="animate-enterprise px-1" style={{ animationDelay: "0ms" } as React.CSSProperties}>
        <h1 className="text-[17px] font-bold leading-tight tracking-tight text-stone-800 sm:text-xl">
          {t("greeting", lang, { name: session?.fullName ?? "" })}
        </h1>
        <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-stone-600">
          <span aria-hidden className="inline-flex h-5 w-5 items-center justify-center rounded-md border border-surface-border bg-surface-card">
            <Calendar className="h-3 w-3 text-stone-500" />
          </span>
          {lang === "bn" ? todayBn : todayEn}
        </p>
      </section>

      {error && (
        <div className="animate-enterprise space-y-2 px-1" style={{ animationDelay: "60ms" } as React.CSSProperties}>
          <ErrorBanner message={t("errorGeneric", lang)} />
          <Button variant="outline" onClick={() => void load()}>{t("retry", lang)}</Button>
        </div>
      )}

      {/* AI Farm Status — brand-gradient hero (offline-safe, no remote imagery) */}
      <section className="animate-enterprise relative overflow-hidden rounded-card bg-hero shadow-card" style={{ animationDelay: "80ms" } as React.CSSProperties}>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.08]"
          style={{
            backgroundImage: "radial-gradient(ellipse at 30% 20%, white 1px, transparent 1.5px), radial-gradient(ellipse at 70% 80%, white 1px, transparent 1.5px)",
            backgroundSize: "180px 180px, 220px 220px",
          }}
        />
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full blur-3xl" aria-hidden style={{ backgroundColor: "var(--color-brand-400)", opacity: 0.2 }} />
        <div className="relative flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 rounded-chip bg-white/10 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-white/85 ring-1 ring-white/15">
              <span className={`h-1.5 w-1.5 animate-pulse rounded-full ${hasRisk ? "bg-warning" : "bg-brand-400"}`} aria-hidden /> AI • {t("healthScore", lang)}
            </p>
            <h2 className="mt-2 text-lg font-extrabold leading-tight text-white sm:text-xl">
              {hasRisk ? t("aiFarmAttention", lang) : t("aiFarmHealthy", lang)}
            </h2>
            <p className="mt-1 max-w-[36ch] text-[13px] leading-relaxed text-white/85">
              {hasRisk ? t("aiFarmAttentionSub", lang) : t("aiFarmHealthySub", lang)}
            </p>
            <Link to="/farm" className="mt-3 inline-flex min-h-[36px] items-center rounded-button bg-white px-3.5 py-1.5 text-[13px] font-bold text-brand-900 shadow-sm hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
              {t("viewDetails", lang)} <span aria-hidden className="ml-1">→</span>
            </Link>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-2 self-center rounded-card bg-white/10 p-3 ring-1 ring-white/15 backdrop-blur sm:self-auto">
            <HealthRing score={healthScore} />
            <span className="text-[11px] font-medium tracking-wide text-white/85">{healthScore}% • {t("activeLabel", lang)}</span>
          </div>
        </div>
      </section>

      {/* 4-card status grid */}
      <section className="animate-enterprise grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" style={{ animationDelay: "140ms" } as React.CSSProperties}>
        {/* আজকের কাজ */}
        <div className="flex flex-col rounded-card border border-surface-border bg-surface-card p-3 shadow-card">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-action text-white shadow-sm" aria-hidden>
              <CheckSquare className="h-3.5 w-3.5" strokeWidth={2.5} />
            </span>
            <h2 className="text-[15px] font-bold text-stone-800">{t("todayTasks", lang)}</h2>
          </div>
          <div className="flex-1 rounded-xl border border-surface-border bg-surface-subdued p-3">
            <ul className="divide-y divide-surface-border">
              {TASK_KEYS.map((task) => {
                const checked = tasks[task.id] ?? false;
                return (
                  <li key={task.id} className="flex items-center gap-3 py-2.5 first:pt-1 last:pb-1">
                    <button type="button" role="checkbox" aria-checked={checked} aria-label={t(task.key, lang)} onClick={() => setTasks((p) => ({ ...p, [task.id]: !p[task.id] }))} className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] focus-visible:ring-offset-2 ring-offset-[var(--color-surface-bg)] ${checked ? "border-action bg-action text-white" : "border-surface-border-strong bg-surface-card"}`}>
                      {checked && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>}
                    </button>
                    <span className={`min-w-0 flex-1 text-[13px] leading-tight ${checked ? "font-medium text-success-text line-through decoration-success-border" : "text-stone-700"}`}>{t(task.key, lang)}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <Link to="/farm" className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg py-2 text-[13px] font-semibold text-link hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]">
            {t("viewAllTasks", lang)} <span aria-hidden>→</span>
          </Link>
        </div>

        {/* আবহাওয়া */}
        <div className="flex flex-col overflow-hidden rounded-card border border-surface-border bg-surface-card shadow-card">
          <div className="flex-1 p-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-[15px] font-bold text-stone-800">{t("weather", lang)}</h2>
              <span aria-hidden className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600 ring-1 ring-inset ring-sky-100"><CloudSun style={{ width: 18, height: 18 }} /></span>
            </div>
            {!loaded && !weather ? (
              <div className="mt-3 space-y-2"><Skeleton className="h-10 w-28" /><Skeleton className="h-4 w-32" /></div>
            ) : weather ? (
              <>
                <div className="mt-1 flex items-baseline gap-1"><span className="text-[42px] font-extrabold leading-none tracking-tight text-stone-800">{weather.current.tempC}°</span></div>
                <p className="text-[13px] text-stone-600">{weatherConditionLabel(weather.current.condition, lang)}</p>
                <div className="mt-4 flex items-center gap-6 text-xs">
                  <span className="flex items-center gap-1.5">
                    <Droplets aria-hidden className="h-4 w-4 text-sky-600" />
                    <span className="flex flex-col leading-none"><span className="text-[11px] font-medium text-stone-600">{t("humidityLabel", lang)}</span><span className="mt-0.5 text-[13px] font-semibold text-stone-700">{weather.current.humidityPct}%</span></span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Wind aria-hidden className="h-4 w-4 text-sky-600" />
                    <span className="flex flex-col leading-none"><span className="text-[11px] font-medium text-stone-600">{t("windLabel", lang)}</span><span className="mt-0.5 text-[13px] font-semibold text-stone-700">{weather.current.windKmh} km/h</span></span>
                  </span>
                </div>
              </>
            ) : <p className="mt-3 text-sm text-stone-500">—</p>}
          </div>
          <div className={`flex items-start gap-2 px-3 py-2.5 ${hasRisk ? "bg-warning-bg" : "bg-success-bg"}`}>
            <Leaf aria-hidden className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${hasRisk ? "text-warning-text" : "text-success-text"}`} />
            <div className="min-w-0">
              <p className={`text-xs font-semibold leading-tight ${hasRisk ? "text-warning-text" : "text-success-text"}`}>{weather && hasRisk ? (lang === "bn" ? weather.risks[0].titleBn : weather.risks[0].titleEn) : t("weatherFavorable", lang)} <span aria-hidden>→</span></p>
              <p className="text-[11px] leading-tight text-stone-600">{weather && hasRisk ? (weatherRiskActionLabel(weather.risks[0].type, lang) ?? t("regularFarmVisit", lang)) : t("regularFarmVisit", lang)}</p>
            </div>
          </div>
        </div>

        {/* চলমান ফসল */}
        <div className="flex flex-col rounded-card border border-surface-border bg-surface-card p-4 text-center shadow-card">
          <h2 className="flex items-center justify-center gap-1.5 text-[15px] font-bold text-stone-800"><Leaf aria-hidden className="h-4 w-4 text-brand-600" /> {t("activeCropsTitle", lang)}</h2>
          <div className="mx-auto mt-4 flex h-[92px] w-[92px] items-center justify-center rounded-full border-2 border-brand-200 bg-brand-50 shadow-sm">
            <Sprout aria-hidden className="h-10 w-10 text-brand-600" strokeWidth={1.6} />
          </div>
          <p className="mt-3 text-base font-bold text-accent">{primaryCrop ? primaryCrop.cropName : lang === "bn" ? "ধান" : "Rice"}</p>
          <span className="mt-2 inline-flex items-center self-center rounded-chip bg-brand-50 px-3 py-1 text-[11px] font-semibold text-accent ring-1 ring-inset ring-brand-100">{primaryCrop ? stageLabel(primaryCrop.stage, lang) : t("growthStage", lang)}</span>
          <Link to="/farm" className="mt-auto flex w-full items-center justify-center gap-1 pt-4 text-[13px] font-semibold text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]">{t("viewDetails", lang)} <span aria-hidden>→</span></Link>
        </div>

        {/* ওয়ালেট */}
        <div className="flex flex-col rounded-card border border-surface-border bg-surface-card p-4 text-center shadow-card">
          <h2 className="flex items-center justify-center gap-1.5 text-[15px] font-bold text-stone-800"><Wallet aria-hidden className="h-4 w-4 text-brand-600" /> {t("wallet", lang)}</h2>
          <div className="mt-6">
            {walletBal !== null ? <p className="text-[28px] font-extrabold tracking-tight text-accent">{formatBDT(walletBal, lang)}</p> : loaded ? <p className="text-[28px] font-extrabold text-stone-500">—</p> : <Skeleton className="mx-auto h-8 w-28" />}
            <p className="mt-1 text-xs text-stone-600">{t("availableBalance", lang)}</p>
          </div>
          <Link to="/wallet" className="mt-auto flex w-full items-center justify-center gap-1 pt-8 text-[13px] font-semibold text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]">{t("viewTransactions", lang)} <span aria-hidden>→</span></Link>
        </div>
      </section>

      {/* AI Assistant Entry — indigo accent moment */}
      <section className="animate-enterprise rounded-card border border-indigo-100 bg-enterprise-ai-light p-4 shadow-card" style={{ animationDelay: "180ms" } as React.CSSProperties}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="inline-flex items-center gap-1.5 rounded-chip bg-enterprise-ai px-2.5 py-1 text-[11px] font-bold tracking-wide text-white">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden /> AI • AgroBridge
            </p>
            <h2 className="mt-2 text-base font-extrabold text-stone-800">{t("aiAskTitle", lang)}</h2>
            <p className="text-[13px] text-stone-600">{t("aiAskSubtitle", lang)}</p>
          </div>
          <Link to="/advisor" className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl bg-enterprise-ai px-5 py-2.5 text-sm font-bold text-white shadow-button hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-enterprise-ai motion-reduce:hover:brightness-100">
            {lang === "bn" ? "প্রশ্ন করুন" : "Ask now"} <span aria-hidden className="ml-1">→</span>
          </Link>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {AI_ACTIONS.map(({ key, icon: Icon }) => (
            <Link key={key} to="/advisor" className="flex items-center gap-2 rounded-xl border border-indigo-100 bg-surface-card px-3 py-2.5 text-xs font-semibold text-stone-700 shadow-sm transition-colors hover:border-indigo-200 hover:bg-enterprise-ai-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-enterprise-ai">
              <Icon aria-hidden className="h-4 w-4 shrink-0 text-enterprise-ai" /> {t(key, lang)}
            </Link>
          ))}
        </div>
      </section>

      {/* দ্রুত সেবা */}
      <section className="animate-enterprise" style={{ animationDelay: "220ms" } as React.CSSProperties}>
        <h2 className="mb-3 px-1 text-base font-bold text-stone-800">{t("quickActions", lang)}</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Link to="/advisor" className="flex items-center gap-3 rounded-card border border-surface-border bg-surface-card p-3 shadow-card transition hover:-translate-y-0.5 hover:shadow-cardHover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-iconBox bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100" aria-hidden><Bot className="h-5 w-5" /></span>
            <span className="min-w-0"><span className="block text-[13px] font-bold leading-tight text-stone-800">{t("aiAgent", lang)}</span><span className="block text-[11px] leading-tight text-stone-600">{t("quickAiSub", lang)}</span></span>
          </Link>
          <Link to="/services" className="flex items-center gap-3 rounded-card border border-surface-border bg-surface-card p-3 shadow-card transition hover:-translate-y-0.5 hover:shadow-cardHover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-iconBox bg-sky-50 text-sky-600 ring-1 ring-inset ring-sky-100" aria-hidden><Tractor className="h-5 w-5" /></span>
            <span className="min-w-0"><span className="block text-[13px] font-bold leading-tight text-stone-800">{t("services", lang)}</span><span className="block text-[11px] leading-tight text-stone-600">{t("quickServiceSub", lang)}</span></span>
          </Link>
          <Link to="/sell" className="flex items-center gap-3 rounded-card border border-surface-border bg-surface-card p-3 shadow-card transition hover:-translate-y-0.5 hover:shadow-cardHover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-iconBox bg-enterprise-ai-light text-enterprise-ai ring-1 ring-inset ring-indigo-100" aria-hidden><Coins className="h-5 w-5" /></span>
            <span className="min-w-0"><span className="block text-[13px] font-bold leading-tight text-stone-800">{t("sellCrop", lang)}</span><span className="block text-[11px] leading-tight text-stone-600">{t("quickSellSub", lang)}</span></span>
          </Link>
          <Link to="/notifications" className="relative flex items-center gap-3 rounded-card border border-surface-border bg-surface-card p-3 shadow-card transition hover:-translate-y-0.5 hover:shadow-cardHover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-iconBox bg-danger-bg text-danger-text ring-1 ring-inset ring-danger-border" aria-hidden><Bell className="h-5 w-5" /></span>
            <span className="min-w-0"><span className="block text-[13px] font-bold leading-tight text-stone-800">{t("notifications", lang)}</span><span className="block text-[11px] leading-tight text-stone-600">{t("quickNotifSub", lang)}</span></span>
            {unread > 0 && <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-danger-text text-[11px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
          </Link>
        </div>
      </section>

      {/* Smart Alerts — enterprise ops */}
      <section className="animate-enterprise rounded-card border border-surface-border bg-surface-card p-4 shadow-card" style={{ animationDelay: "260ms" } as React.CSSProperties}>
        <h2 className="flex items-center gap-2 text-sm font-bold text-stone-800">
          <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-full bg-warning-bg text-warning-text"><TriangleAlert className="h-3.5 w-3.5" /></span>
          {t("alertsTitle", lang)}
        </h2>
        {/* Smart Alerts — driven by the live weather risks on this screen;
            falls back to the favorable-state line when there is nothing actionable. */}
        <ul className="mt-3 space-y-2">
          {hasRisk && weather ? (
            actionableRisks(weather).slice(0, 2).map((r) => (
              <li key={`${r.type}-${r.severity}`} className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-enterprise-warning" aria-hidden />
                <span className="text-xs leading-relaxed text-stone-700">
                  {lang === "bn" ? r.titleBn : r.titleEn}
                  {(() => {
                    const action = weatherRiskActionLabel(r.type, lang);
                    return action ? <span className="text-stone-500"> — {action}</span> : null;
                  })()}
                </span>
              </li>
            ))
          ) : (
            <>
              <li className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-enterprise-warning" aria-hidden />
                <span className="text-xs leading-relaxed text-stone-700">{t("alertRain", lang)}</span>
              </li>
              <li className="flex items-start gap-2 rounded-xl border border-sky-100 bg-sky-50 px-3 py-2.5">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-600" aria-hidden />
                <span className="text-xs leading-relaxed text-stone-700">{t("alertPest", lang)}</span>
              </li>
            </>
          )}
        </ul>
      </section>
    </div>
  );
}
