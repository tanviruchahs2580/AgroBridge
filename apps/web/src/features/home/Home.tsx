import { Link } from "react-router-dom";
import {
  Bot, CheckSquare, CloudSun, Droplets, FlaskConical, Leaf,
  Sprout, Stethoscope, TriangleAlert, Wind,
} from "lucide-react";
import { api } from "../../lib/api";
import type { FarmListItem, NotificationsData, WeatherData } from "../../lib/api-types";
import { useResource } from "../../lib/useResource";
import { RESOURCE_KEYS } from "../../lib/resourceKeys";
import { useSession } from "../../lib/session";
import { t } from "../../lib/i18n";
import { careToneClass, cropLabel, stageLabel, weatherConditionLabel, weatherRiskActionLabel } from "../../lib/labels";
import { actionableRisks } from "../../lib/weatherRisks";
import { deriveTodayTasks } from "./todayTasks";
import { weatherProvenanceLine } from "./weatherProvenance";
import { getWeatherCoords, isDistrictResolved } from "../../lib/geo";
import { Button, ErrorBanner, Skeleton } from "../../components/ui";
import { RiceEarMedallion } from "../../components/icons/AgriIcons";
import { QuickServices } from "./QuickServices";

/**
 * Farm health indicator derived from the data actually loaded on this screen
 * (farms, active crop cycles, weather risks). It is a deterministic readiness
 * meter, not an AI verdict — only actionable risks (non-INFO, non-LOW) count
 * against the score. The filter is shared with MyFarm via lib/weatherRisks.ts:
 * MyFarm used to read `risks[0]` unfiltered and so showed a favourable advisory
 * as a warning while this screen correctly showed no risk.
 */
function computeHealthScore(farms: FarmListItem[], weather: WeatherData | null): number {
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
        {/* `transition-[stroke-dashoffset]`, not `transition-all`: only the arc's
            offset animates here, and `transition-all` kept every other property
            (including `stroke-width` and the layout-affecting box) on a
            700 ms transition for any change — the classic way a cheap animation
            turns into a repaint budget problem on the devices this app targets. */}
        <circle cx="46" cy="46" r={r} stroke="var(--color-brand-400)" strokeWidth="7" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off} className="drop-shadow-sm transition-[stroke-dashoffset] duration-700" />
      </svg>
      <span className="absolute text-xl font-extrabold text-white">{score}%</span>
    </div>
  );
}

const AI_ACTIONS: { key: import("../../lib/i18n").DictKey; icon: typeof Bot }[] = [
  { key: "aiActionDiagnose", icon: Stethoscope },
  { key: "aiActionPlant", icon: Sprout },
  { key: "aiActionFertilizer", icon: FlaskConical },
  { key: "aiActionWeather", icon: CloudSun },
];

export default function Home() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";

  // Three independent reads, three independent resources — the tolerance the old
  // `Promise.allSettled` gave by hand. A failed weather read can no longer blank
  // the farm data (and the readiness meter computed from it), and a failed farm
  // read leaves the weather card and the unread badge on screen.
  // `farms` is the same family MyFarm uses: both screens read the identical
  // `GET /farms`, so adding a farm there invalidates this list too.
  const farmsRes = useResource<FarmListItem[]>(RESOURCE_KEYS.farms, () => api<FarmListItem[]>("GET", "/farms"));
  const notifRes = useResource<NotificationsData>(RESOURCE_KEYS.notifications, () => api<NotificationsData>("GET", "/notifications"));
  // `session?.district` is a real dependency: weather is localised to it, so a
  // profile change must refetch rather than keep showing the old area.
  const weatherRes = useResource<WeatherData>(
    RESOURCE_KEYS.weather,
    () => {
      const coords = getWeatherCoords(session?.district);
      return api<WeatherData>("GET", `/weather?lat=${coords.lat}&lng=${coords.lng}`);
    },
    [session?.district]
  );

  const farms = farmsRes.data ?? [];
  const weather = weatherRes.data;
  const unread = notifRes.data?.unread ?? 0;
  /**
   * The states this screen used to guess at.
   *
   * `farms.length === 0` is true both for "this farmer has no farms" and for "the
   * farm read failed", and the page rendered the *empty* copy for both — telling a
   * farmer who owns three farms to add their first one because the request failed.
   * The weather read has the same shape: `weather` is null while loading, after a
   * failure, and when the provider returns nothing, and every consumer below treated
   * all three as "no weather".
   */
  const farmsUnavailable = Boolean(farmsRes.error);
  const unreadKnown = !notifRes.error && notifRes.data !== null;
  // Today's tasks are derived from the same `GET /farms` crop cycles the rest of
  // the screen reads (stage + planting date, via the shared care logic). Up to
  // three real suggestions — nothing pre-checked, nothing persisted, because no
  // task-completion write exists on the API.
  const todayTasks = deriveTodayTasks(farms, lang);

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
        {/* On the scale: this was the only page <h1> sized off it (17px, not a
            step, against the 20px every PageHeader screen uses). */}
        <h1 className="text-lg font-bold leading-tight tracking-tight text-stone-800 sm:text-xl">
          {t("greeting", lang, { name: session?.fullName ?? "" })}
        </h1>
        <p className="mt-1 text-sm text-stone-600">{lang === "bn" ? todayBn : todayEn}</p>
      </section>

      {/* The page-level error was ever only the farm read: a rejected
          `/notifications` or `/weather` degraded silently then, and still does.
          The banner and its retry belong to that one resource. */}
      {farmsRes.error && (
        <div className="animate-enterprise space-y-2 px-1" style={{ animationDelay: "60ms" } as React.CSSProperties}>
          <ErrorBanner message={t("errorGeneric", lang)} />
          <Button variant="outline" onClick={() => void farmsRes.reload()}>{t("retry", lang)}</Button>
        </div>
      )}

      {/* Farm readiness — owner-supplied field photo (images/hero-farm.jpg,
          2026-11-12) behind the state heading, per the owner's after-condition
          mock. bg-hero stays underneath as the graceful fallback if the image
          fails to load; the scrim tokens live in the token layer (rgba, both
          themes identical) like the auth washes. Everything functional here is
          unchanged: the four heading states, the CTA target and the ring's
          data source. */}
      <section className="animate-enterprise relative overflow-hidden rounded-card bg-hero shadow-float" style={{ animationDelay: "80ms" } as React.CSSProperties}>
        <img
          src="/images/hero-farm.jpg"
          alt=""
          aria-hidden
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div aria-hidden className="absolute inset-0 bg-[image:var(--gradient-hero-scrim-narrow)] md:bg-[image:var(--gradient-hero-scrim-wide)]" />
        <div className="relative flex flex-col gap-3 p-4 sm:p-5">
          {/* The readiness pill returns at the owner's request (their mock shows
              it); it names the meter below, not the state — the heading above
              it carries the state, as documented when the previous pill was
              removed. */}
          <span className="inline-flex w-fit items-center gap-1.5 rounded-chip bg-action px-2.5 py-1 text-2xs font-bold tracking-wide text-white ring-1 ring-white/25">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-300" />
            {t("farmReadiness", lang)}
          </span>
          <h2 className="text-lg font-extrabold leading-tight text-white sm:text-xl">
            {farmsUnavailable
              ? t("farmDataUnavailable", lang)
              : farms.length === 0
                ? t("aiFarmEmptyTitle", lang)
                : hasRisk
                  ? t("aiFarmAttention", lang)
                  : t("aiFarmHealthy", lang)}
          </h2>
          {/* The owner's mock carries a sub-line naming the three inputs. It is
              shown only in the healthy state — under "attention" or "empty" it
              would contradict the heading — and unlike the removed restating
              sentence it adds the inputs, not a repeat. */}
          {!farmsUnavailable && farms.length > 0 && !hasRisk && (
            <p className="-mt-1 max-w-[46ch] text-sm leading-relaxed text-white/90">
              {t("aiFarmHealthySub", lang)}
            </p>
          )}
          <div>
            <Link to="/farm" className="mt-1 inline-flex min-h-[44px] items-center rounded-button bg-white px-3.5 py-1.5 text-sm font-bold text-brand-900 shadow-sm hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
              {t("viewDetails", lang)} <span aria-hidden className="ml-1">→</span>
            </Link>
          </div>
          {/* The readiness ring is computed from the farm/crop records and today's
              weather. With no farm on file there is nothing to score, so the
              number is withheld rather than showing a floor value as if it meant
              something. Ring and caption sit side by side, as in the mock. */}
          {farmsUnavailable ? (
            // No number: the reads that produce it did not complete, and a score
            // computed from an empty array would be a fabricated 60%.
            <div className="mt-1 flex shrink-0 items-center gap-3 self-start rounded-card bg-white/10 p-3 text-left ring-1 ring-white/15 backdrop-blur">
              <TriangleAlert className="h-6 w-6 shrink-0 text-white/80" aria-hidden />
              <span className="max-w-[24ch] text-xs font-medium leading-snug tracking-wide text-white/85">
                {t("farmDataUnavailable", lang)}
              </span>
            </div>
          ) : farms.length === 0 ? (
            <div className="mt-1 flex shrink-0 items-center gap-3 self-start rounded-card bg-white/10 p-3 text-left ring-1 ring-white/15 backdrop-blur">
              <Sprout className="h-6 w-6 shrink-0 text-white/80" aria-hidden />
              <span className="max-w-[22ch] text-xs font-medium leading-snug tracking-wide text-white/85">
                {t("aiFarmEmptyMeter", lang)}
              </span>
            </div>
          ) : (
            <div className="mt-1 flex shrink-0 items-center gap-3 self-start rounded-card bg-white/10 p-3 ring-1 ring-white/15 backdrop-blur">
              <HealthRing score={healthScore} />
              {/* The caption names the meter, and — when the weather read failed
                  and computeHealthScore therefore skipped that term — says so.
                  It used to be a sentence ("From your records and today's
                  weather"); the honesty it carried is the second half of it, so
                  that half is what stays. */}
              <span className="max-w-[20ch] text-2xs leading-snug text-white/80">
                {weather ? t("farmReadiness", lang) : t("farmReadinessBasisNoWeather", lang)}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* 4-card status grid */}
      <section className="animate-enterprise grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" style={{ animationDelay: "140ms" } as React.CSSProperties}>
        {/* আজকের কাজ — real suggestions derived from the user's active crop
            cycles. No checkbox: there is no write API for task completion, so a
            tick would only ever be local fiction. No progress badge either. */}
        <div className="flex flex-col overflow-hidden rounded-card border border-surface-border bg-surface-card shadow-card">
          <div className="flex items-center justify-between gap-2 border-b border-surface-border bg-surface-subdued px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-iconBox bg-action text-white shadow-sm" aria-hidden>
                <CheckSquare className="h-3.5 w-3.5" strokeWidth={2.5} />
              </span>
              <h2 className="text-md font-bold text-stone-800">{t("todayTasks", lang)}</h2>
            </div>
          </div>
          <div className="flex-1 p-2">
            {farmsRes.loading ? (
              <div className="space-y-2 p-2"><Skeleton className="h-11 w-full" /><Skeleton className="h-11 w-full" /></div>
            ) : todayTasks.length > 0 ? (
              <ul className="divide-y divide-surface-border">
                {todayTasks.map((task) => (
                  <li key={task.id} className="flex items-start gap-3 rounded-lg px-2 py-2.5">
                    <span className={`mt-0.5 shrink-0 rounded-chip border px-2 py-0.5 text-xs font-semibold ${careToneClass(task.care.tone)}`}>{task.care.label}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm leading-tight text-stone-700">{task.care.task}</span>
                      <span className="mt-0.5 block truncate text-xs leading-tight text-stone-500">
                        {task.farmName} • {task.plotName} — {cropLabel(task.cropName, lang)} • {stageLabel(task.stage, lang)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex flex-col items-center gap-2 p-4 text-center">
                <Sprout className="h-6 w-6 text-brand-600" aria-hidden />
                <p className="text-sm font-semibold text-stone-700">{t("noActiveCrops", lang)}</p>
              </div>
            )}
          </div>
          <Link to="/farm" className="flex items-center justify-center gap-1 border-t border-surface-border py-2.5 text-sm font-semibold text-link transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]">
            {t("viewAllTasks", lang)} <span aria-hidden>→</span>
          </Link>
        </div>

        {/* আবহাওয়া */}
        <div className="flex flex-col overflow-hidden rounded-card border border-surface-border bg-surface-card shadow-card">
          <div className="relative flex-1 p-4">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-[0.07]" aria-hidden style={{ background: "var(--gradient-sky)" }} />
            <div className="relative flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-md font-bold text-stone-800">{t("weather", lang)}</h2>
                {/* Weather is resolved from the profile district; say so plainly
                    instead of presenting a national default as local advice. */}
                <p className="mt-0.5 truncate text-xs text-stone-500">
                  {isDistrictResolved(session?.district) ? (
                    session?.district
                  ) : (
                    <Link to="/settings" className="font-semibold text-link hover:underline">
                      {t("districtWeatherHintShort", lang)}
                    </Link>
                  )}
                </p>
              </div>
              <span aria-hidden className="flex h-9 w-9 items-center justify-center rounded-iconBox bg-sky-50 text-sky-600 ring-1 ring-inset ring-sky-100 shadow-sm"><CloudSun style={{ width: 20, height: 20 }} /></span>
            </div>
            {/* The old `loaded` flag gated this skeleton on the *farm* read, so a
                failed weather fetch showed a spinner forever. The weather card now
                follows its own resource: loading ⇒ skeleton, settled ⇒ data, and a
                failed read says so with a retry instead of a bare "—" that left the
                user unable to tell "no reading" from "no weather service". */}
            {weatherRes.loading ? (
              <div className="relative mt-3 space-y-2"><Skeleton className="h-10 w-28" /><Skeleton className="h-4 w-32" /></div>
            ) : weather ? (
              <>
                <div className="relative mt-2 flex items-end justify-between gap-2">
                  <div>
                    <div className="flex items-baseline gap-0.5"><span className="text-display font-extrabold leading-none tracking-tight text-stone-800 tabular-nums">{weather.current.tempC}°</span></div>
                    <p className="mt-1 text-sm text-stone-600">{weatherConditionLabel(weather.current.condition, lang)}</p>
                  </div>
                </div>
                <div className="relative mt-4 grid grid-cols-2 gap-2">
                  <span className="flex items-center gap-2 rounded-xl border border-surface-border bg-surface-subdued px-3 py-2">
                    <Droplets aria-hidden className="h-4 w-4 shrink-0 text-sky-600" />
                    <span className="flex min-w-0 flex-col leading-none"><span className="truncate text-xs font-medium text-stone-600">{t("humidityLabel", lang)}</span><span className="mt-0.5 text-sm font-bold tabular-nums text-stone-700">{weather.current.humidityPct}%</span></span>
                  </span>
                  <span className="flex items-center gap-2 rounded-xl border border-surface-border bg-surface-subdued px-3 py-2">
                    <Wind aria-hidden className="h-4 w-4 shrink-0 text-sky-600" />
                    <span className="flex min-w-0 flex-col leading-none"><span className="truncate text-xs font-medium text-stone-600">{t("windLabel", lang)}</span><span className="mt-0.5 text-sm font-bold tabular-nums text-stone-700">{weather.current.windKmh} km/h</span></span>
                  </span>
                </div>
                {/* Provenance: fetched time + source, "cached copy" when the
                    provider payload was reused. The time is always the ORIGINAL
                    fetch time, never the response time. */}
                <p className="relative mt-3 text-xs text-stone-500">{weatherProvenanceLine(weather, lang)}</p>
              </>
            ) : (
              <div className="relative mt-3 space-y-2">
                <p className="flex items-start gap-1.5 text-sm leading-snug text-warning-text">
                  <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
                  {t("weatherUnavailable", lang)}
                </p>
                <Button variant="outline" size="sm" onClick={() => void weatherRes.reload()}>
                  {t("retry", lang)}
                </Button>
              </div>
            )}
          </div>
          {/* No status strip here any more. It printed the same two strings as the
              Smart Alerts section below it — when clear, the identical
              "আবহাওয়া অনুকূল / নিয়মিত ফার্ম পরিশোধন" pair; when risky, the same
              risk title and action. The advisory belongs to the advisory section,
              so this card now carries the reading (temperature, condition, wind,
              provenance) and nothing repeats. It also read `risks[0]` raw while
              `hasRisk` used the filtered list, so an INFO-level favourable
              advisory could take the warning branch on this very strip. */}
        </div>

        {/* চলমান ফসল */}
        <div className="flex flex-col overflow-hidden rounded-card border border-surface-border bg-surface-card shadow-card">
          <div className="flex items-center gap-2 border-b border-surface-border bg-surface-subdued px-4 py-3">
            <span aria-hidden className="flex h-7 w-7 items-center justify-center rounded-iconBox bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100"><Leaf className="h-3.5 w-3.5" /></span>
            <h2 className="text-md font-bold text-stone-800">{t("activeCropsTitle", lang)}</h2>
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-4">
            {primaryCrop ? (
              <div className="flex items-center gap-3">
                <RiceEarMedallion size={72} />
                <div className="min-w-0 text-left">
                  {/* `cropLabel`, like the task rows above: the raw API enum
                      ("RICE") was leaking into the Bengali UI. */}
                  <p className="text-base font-extrabold leading-tight text-accent">{cropLabel(primaryCrop.cropName, lang)}</p>
                  <span className="mt-1.5 inline-flex items-center gap-1 rounded-chip bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-accent ring-1 ring-inset ring-brand-100">
                    <Sprout aria-hidden className="h-3 w-3" strokeWidth={2} />
                    {stageLabel(primaryCrop.stage, lang)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 text-center">
                <RiceEarMedallion size={56} />
                <p className="text-sm font-semibold text-stone-700">{t("noActiveCrops", lang)}</p>
              </div>
            )}
          </div>
          <Link to="/farm" className="flex items-center justify-center gap-1 border-t border-surface-border py-2.5 text-sm font-semibold text-link transition-colors hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]">{t("viewDetails", lang)} <span aria-hidden>→</span></Link>
        </div>

      </section>

      {/* AI Assistant Entry — indigo accent moment */}
      <section className="animate-enterprise rounded-card border border-indigo-100 bg-enterprise-ai-light p-4 shadow-card" style={{ animationDelay: "180ms" } as React.CSSProperties}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          {/* No "AI • AgroBridge" pill (the card already wears the AI accent and
              sits inside the app) and no "How can I help your farm today?" line —
              the four actions below are the answer to that question. */}
          <h2 className="text-base font-extrabold text-stone-800">{t("aiAskTitle", lang)}</h2>
          <Link to="/advisor" className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl bg-enterprise-ai-strong px-5 py-2.5 text-sm font-bold text-white shadow-button hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-enterprise-ai motion-reduce:hover:brightness-100">
            {t("askNow", lang)} <span aria-hidden className="ml-1">→</span>
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

      {/* দ্রুত সেবা — owner-approved redesign (2026-11-12): dark forest-green
          panel, 2×2 cards, its own section-scoped tokens. The component is
          presentational; the destinations and the unread state below are the
          same ones the inline tiles used, passed straight through. */}
      <QuickServices lang={lang} unread={unread} unreadKnown={unreadKnown} />

      {/* Smart Alerts — live weather risks only; a quiet state when clear */}
      <section className="animate-enterprise rounded-card border border-surface-border bg-surface-card p-4 shadow-card" style={{ animationDelay: "260ms" } as React.CSSProperties}>
        <h2 className="flex items-center gap-2 text-sm font-bold text-stone-800">
          <span aria-hidden className="flex h-6 w-6 items-center justify-center rounded-full bg-warning-bg text-warning-text"><TriangleAlert className="h-3.5 w-3.5" /></span>
          {t("alertsTitle", lang)}
        </h2>
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
          ) : weather ? (
            <li className="flex items-start gap-2 rounded-xl border border-surface-border bg-surface-subdued px-3 py-2.5">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-success-border" aria-hidden />
              <span className="text-xs leading-relaxed text-stone-700">{t("weatherFavorable", lang)} — {t("regularFarmVisit", lang)}</span>
            </li>
          ) : (
            // hasRisk is false when the weather read failed or is still running,
            // and this branch answered that with "Weather favorable" — an agronomic
            // all-clear derived from no data at all.
            <li className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-text" aria-hidden />
              <span className="text-xs leading-relaxed text-warning-text">{t("alertsUnavailable", lang)}</span>
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
