import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";
import type { DictKey } from "../lib/i18n.js";
import { formatBDT } from "../lib/format.js";
import { stageLabel, weatherRiskActionLabel } from "../lib/labels.js";
import { Bell, Bot, CheckSquare, CloudSun, Coins, Leaf, Tractor, Wallet, Zap } from "lucide-react";
import { Badge, Button, Card, ErrorBanner, Skeleton } from "../components/ui.jsx";

interface FarmShape {
  id: string;
  name: string;
  plots: { id: string; cropCycles: { id: string; cropName: string; stage: string }[] }[];
}
interface WeatherShape {
  current: { tempC: number; humidityPct: number; windKmh: number; condition: string };
  risks: { type: string; severity: string; titleBn: string; titleEn: string }[];
}

const SEVERITY_STYLES: Record<string, string> = {
  HIGH: "bg-red-100 text-red-800",
  MODERATE: "bg-amber-100 text-amber-800",
  LOW: "bg-green-100 text-green-800",
};

const TASK_KEYS: { id: string; key: DictKey }[] = [
  { id: "t1", key: "taskWaterCheck" },
  { id: "t2", key: "taskFertilizerCheck" },
  { id: "t3", key: "taskPestScout" },
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
  const [tasks, setTasks] = useState<Record<string, boolean>>({ t1: false, t2: false, t3: false });

  async function load() {
    setError(false);
    setLoaded(false);
    try {
      // Parallel loads — weather no longer waits for the other calls,
      // and the wasted /auth/me round-trip is gone (session already has it).
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

  const activeCrops = farms.flatMap((f) => f.plots.flatMap((p) => p.cropCycles));
  const todayStr = new Intl.DateTimeFormat(lang === "bn" ? "bn-BD" : "en-GB", {
    weekday: "long", day: "numeric", month: "long",
  }).format(new Date());

  return (
    <div className="min-w-0 space-y-6 overflow-hidden px-2 sm:px-0">
      <section>
        <h1 className="text-xl font-bold text-stone-800">{t("greeting", lang, { name: session?.fullName ?? "" })}</h1>
        <p className="text-sm text-stone-600">{todayStr} · {t("tagline", lang)}</p>
      </section>

      {error && (
        <ErrorBanner message={t("errorGeneric", lang)} />
      )}
      {error && (
        <Button variant="outline" onClick={() => void load()}>{t("retry", lang)}</Button>
      )}

      {farms.length === 0 && !localStorage.getItem("ab_onboarded") && (
        <Card className="flex flex-wrap items-center justify-between gap-4 bg-green-50">
          <p className="text-sm font-medium text-green-900">{t("setupBanner", lang)}</p>
          <Link to="/onboarding" className="inline-flex min-h-[44px] items-center rounded-lg bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-800">
            {t("getStarted", lang)}
          </Link>
        </Card>
      )}

      {/* Decision-first: Today's tasks */}
      <Card>
        <h2 className="mb-3 flex items-center gap-2 font-semibold text-stone-700">
          <CheckSquare className="h-5 w-5 text-green-700" aria-hidden /> {t("todayTasks", lang)}
        </h2>
        <ul className="space-y-2">
          {TASK_KEYS.map((task) => (
            <li key={task.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={tasks[task.id] ?? false}
                onChange={() => setTasks((prev) => ({ ...prev, [task.id]: !prev[task.id] }))}
                className="h-5 w-5 rounded border-stone-300 text-green-700 focus:ring-green-600"
                aria-label={t(task.key, lang)}
              />
              <span className={`text-sm ${(tasks[task.id] ?? false) ? "text-stone-500 line-through" : "text-stone-700"}`}>
                {t(task.key, lang)}
              </span>
            </li>
          ))}
        </ul>
        {activeCrops.length === 0 && (
          <p className="mt-3 text-xs text-stone-600">
            {t("addFirstCropHint", lang)}{" "}
            <Link to="/farm" className="font-semibold text-green-700 hover:underline">{t("myFarm", lang)} →</Link>
          </p>
        )}
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Weather card with paired action lines */}
        <Card>
          <h2 className="mb-2 flex items-center gap-2 font-semibold text-stone-700"><CloudSun className="h-5 w-5 text-sky-600" aria-hidden /> {t("weather", lang)}</h2>
          {!loaded && !weather ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-24" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : weather ? (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-bold text-green-800">{weather.current.tempC}°</span>
                <span className="text-sm text-stone-600">{weather.current.condition}</span>
              </div>
              <p className="mt-1 text-xs text-stone-500">
                {t("humidityLabel", lang)} {weather.current.humidityPct}% · {t("windLabel", lang)} {weather.current.windKmh} km/h
              </p>
              <div className="mt-3 space-y-2">
                {weather.risks.map((r, i) => {
                  const action = weatherRiskActionLabel(r.type, lang);
                  return (
                    <div key={i} className={`rounded-lg p-2 text-xs ${SEVERITY_STYLES[r.severity] ?? "bg-stone-100"}`}>
                      <span className="font-semibold">{lang === "bn" ? r.titleBn : r.titleEn}</span>
                      {action && <span className="mt-0.5 block opacity-90">{action}</span>}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <p className="text-sm text-stone-500">—</p>
          )}
        </Card>

        {/* Active crops */}
        <Card>
          <h2 className="mb-2 flex items-center gap-2 font-semibold text-stone-700"><Leaf className="h-5 w-5 text-green-700" aria-hidden /> {t("activeCropsTitle", lang)}</h2>
          {activeCrops.length > 0 ? (
            <ul className="space-y-2 text-sm">
              {activeCrops.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-lg bg-green-50 px-3 py-2">
                  <span className="font-medium">{c.cropName}</span>
                  <Badge className="bg-green-200 text-green-900">{stageLabel(c.stage, lang)}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-stone-500">
              {t("noCropsYet", lang)}{" "}
              <Link to="/farm" className="font-semibold text-green-700 hover:underline">{t("myFarm", lang)} →</Link>
            </p>
          )}
        </Card>

        {/* Wallet teaser */}
        <Card>
          <h2 className="mb-2 flex items-center gap-2 font-semibold text-stone-700"><Wallet className="h-5 w-5 text-green-700" aria-hidden /> {t("wallet", lang)}</h2>
          {walletBal !== null ? (
            <p className="text-2xl font-bold text-green-800">{formatBDT(walletBal, lang)}</p>
          ) : loaded ? (
            <p className="text-2xl font-bold text-stone-300">—</p>
          ) : (
            <Skeleton className="h-8 w-28" />
          )}
          <p className="text-xs text-stone-600">{t("availableBalance", lang)}</p>
          <Link
            to="/wallet"
            className="mt-3 inline-flex min-h-[44px] w-full items-center justify-center rounded-lg border border-green-700 px-4 py-2 font-semibold text-green-800 hover:bg-green-50"
          >
            {t("wallet", lang)} →
          </Link>
        </Card>

        {/* Quick actions */}
        <Card className="flex flex-col gap-2 sm:col-span-2 lg:col-span-3">
          <h2 className="mb-1 flex items-center gap-2 font-semibold text-stone-700"><Zap className="h-5 w-5 text-amber-600" aria-hidden /> {t("quickActions", lang)}</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            <Link to="/advisor" className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-green-700 px-4 py-2 font-semibold text-green-800 hover:bg-green-50"><Bot className="h-5 w-5" aria-hidden /> {t("aiAgent", lang)}</Link>
            <Link to="/services" className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-green-700 px-4 py-2 font-semibold text-green-800 hover:bg-green-50"><Tractor className="h-5 w-5" aria-hidden /> {t("services", lang)}</Link>
            <Link to="/sell" className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-green-700 px-4 py-2 font-semibold text-green-800 hover:bg-green-50"><Coins className="h-5 w-5" aria-hidden /> {t("sellCrop", lang)}</Link>
            <Link to="/notifications" className="relative inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-green-700 px-4 py-2 font-semibold text-green-800 hover:bg-green-50">
              <Bell className="h-5 w-5" aria-hidden /> {t("notifications", lang)}
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">{unread}</span>
              )}
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
