import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import type { FarmListItem, WeatherData } from "../../lib/api-types";
import { invalidate, useResource } from "../../lib/useResource";
import { RESOURCE_KEYS } from "../../lib/resourceKeys";
import { useSession } from "../../lib/session";
import { t } from "../../lib/i18n";
import { dateLocale } from "../../lib/format";
import { CROPS, CROP_KEYS, careToneClass, cropLabel, stageLabel, farmCareSuggestion } from "../../lib/labels";
import { actionableRisks } from "../../lib/weatherRisks";
import { getWeatherCoords } from "../../lib/geo";
import { mapError } from "../../lib/errors-ui";
import { track } from "../../lib/analytics";
import { Leaf, MapPin, Tractor, CalendarClock, Sprout, Bot, Wrench, ShoppingBag, TriangleAlert, ClipboardList, Home as HomeIcon } from "lucide-react";
import { BlockError, Button, Card, EmptyState, Input, Label, Select, Skeleton, useToast } from "../../components/ui";

export default function MyFarm() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const toast = useToast();

  // The page has two independent concerns, so it holds two resources: the farm
  // records — plots and crop cycles come with the farm list, and every mutation
  // below changes it — and the district's weather, which only the AI briefing
  // reads. A failed farms read no longer takes the weather block down with it, and
  // a failed weather read cannot hide the farm data.
  const farmsRes = useResource<FarmListItem[]>(RESOURCE_KEYS.farms, () => api<FarmListItem[]>("GET", "/farms"));
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

  // Memoised so the fallback array keeps its identity: `stats` and `todayTasks`
  // below depend on this value, and a fresh `[]` per render would recompute them
  // on every render (react-hooks/exhaustive-deps).
  const farms = useMemo(() => farmsRes.data ?? [], [farmsRes.data]);
  // The old nested `catch` nulled the weather on failure, so a weather outage hid
  // the risk line instead of raising an error over the farm data. Same intent, now
  // read off the weather resource's own error: failed ⇒ no risks shown.
  const weather = weatherRes.error ? null : weatherRes.data;
  // Only advisories worth acting on reach the UI; see lib/weatherRisks.ts.
  const firstRisk = useMemo(() => actionableRisks(weather)[0], [weather]);

  const [busy, setBusy] = useState(false);
  const [showFarmForm, setShowFarmForm] = useState(false);
  const [plotFor, setPlotFor] = useState<string | null>(null);
  const [cropPlotId, setCropPlotId] = useState<string | null>(null);
  const [selectedFarm, setSelectedFarm] = useState<string | null>(null);
  const [formErrs, setFormErrs] = useState<Record<string, string>>({});

  const stats = useMemo(() => {
    const plots = farms.flatMap((f) => f.plots);
    const cycles = plots.flatMap((p) => p.cropCycles.filter((c) => c.status === "ACTIVE"));
    const totalBigha = farms.reduce((sum, f) => sum + (f.totalAreaBigha ?? 0), 0);
    return { farms: farms.length, plots: plots.length, crops: cycles.length, totalBigha };
  }, [farms]);

  // Care suggestions derived from each crop's real stage + planting date.
  const todayTasks = useMemo(() => {
    const cycles = farms.flatMap((f) => f.plots.flatMap((p) => p.cropCycles.filter((c) => c.status === "ACTIVE").map((c) => ({ ...c, plotName: p.name, farmName: f.name, farmId: f.id }))));
    return cycles.slice(0, 3).map((c) => ({ ...c, care: farmCareSuggestion(c, lang) }));
  }, [farms, lang]);

  const farmDetail = selectedFarm ? farms.find((f) => f.id === selectedFarm) : null;

  async function createFarm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    const errs: Record<string, string> = {};
    if (name.length < 2) errs.name = t("errNameTooShort", lang);
    setFormErrs(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await api("POST", "/farms", { name, district: String(fd.get("district") ?? "").trim() || undefined, totalAreaBigha: Number(fd.get("area")) || undefined });
      track("farm_created"); toast.success(t("farmCreatedToast", lang)); setShowFarmForm(false); (e.target as HTMLFormElement).reset();
      // The old `load` refetched the farm list and the district weather after
      // every mutation — both families are invalidated, no more and no less.
      invalidate(RESOURCE_KEYS.farms);
      invalidate(RESOURCE_KEYS.weather);
    } catch (err) { toast.error(mapError(err, lang)); } finally { setBusy(false); }
  }
  async function createPlot(e: React.FormEvent<HTMLFormElement>, farmId: string) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const area = Number(fd.get("area"));
    if (!fd.get("name") || !area || area <= 0) { toast.error(t("errFieldRequired", lang)); return; }
    setBusy(true);
    try {
      await api("POST", `/farms/${farmId}/plots`, { name: fd.get("name"), areaBigha: area, soilType: String(fd.get("soil") ?? "").trim() || undefined });
      toast.success(t("plotCreatedToast", lang)); setPlotFor(null); (e.target as HTMLFormElement).reset();
      // Same refetch set as the old `load`.
      invalidate(RESOURCE_KEYS.farms);
      invalidate(RESOURCE_KEYS.weather);
    } catch (err) { toast.error(mapError(err, lang)); } finally { setBusy(false); }
  }
  async function createCrop(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (!cropPlotId || !fd.get("crop") || !fd.get("date")) { toast.error(t("errFieldRequired", lang)); return; }
    setBusy(true);
    try {
      await api("POST", "/farms/crops", { plotId: cropPlotId, cropName: fd.get("crop"), plantedAt: new Date(fd.get("date") as string).toISOString() });
      toast.success(t("cropCreatedToast", lang)); setCropPlotId(null); (e.target as HTMLFormElement).reset();
      // Same refetch set as the old `load`.
      invalidate(RESOURCE_KEYS.farms);
      invalidate(RESOURCE_KEYS.weather);
    } catch (err) { toast.error(mapError(err, lang)); } finally { setBusy(false); }
  }

  if (farmDetail) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => setSelectedFarm(null)} className="inline-flex items-center gap-1 rounded text-sm font-medium text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]">← {t("back", lang)}</button>
        <div className="rounded-card border border-surface-border bg-surface-card p-5 shadow-card">
          <h2 className="text-lg font-bold text-stone-800">{farmDetail.name}</h2>
          <p className="text-xs text-stone-600">{[farmDetail.district, farmDetail.totalAreaBigha ? `${farmDetail.totalAreaBigha} ${t("bighaShort", lang)}` : null].filter(Boolean).join(" · ")} • {farmDetail.plots.length} {t("myFarmPlotCount", lang)}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {farmDetail.plots.map((plot) => (
              <div key={plot.id} className="rounded-2xl border border-surface-border bg-surface-subdued p-4">
                <p className="flex items-center gap-1 text-sm font-semibold text-stone-800"><MapPin className="h-4 w-4 text-stone-500" /> {plot.name} ({plot.areaBigha} {t("bighaShort", lang)})</p>
                {plot.cropCycles.length > 0 ? plot.cropCycles.map((c) => {
                  const care = farmCareSuggestion(c, lang);
                  return (
                    <div key={c.id} className="mt-3 flex items-center gap-2 rounded-xl bg-surface-card px-3 py-2 shadow-sm">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100"><Leaf className="h-4 w-4" /></span>
                      <div className="min-w-0"><p className="text-sm font-semibold text-stone-800">{cropLabel(c.cropName, lang)} • {stageLabel(c.stage, lang)}</p><p className="text-xs text-stone-600">{new Date(c.plantedAt).toLocaleDateString(dateLocale(lang))} • {care.task}</p></div>
                      <span className={`ml-auto shrink-0 rounded-chip border px-2 py-0.5 text-xs font-semibold ${careToneClass(care.tone)}`}>{care.label}</span>
                    </div>
                  );
                }) : <p className="mt-2 text-xs text-stone-500">{t("noPlotsYet", lang)}</p>}
                <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => setCropPlotId(cropPlotId===plot.id?null:plot.id)}>+ {t("addCrop", lang)}</Button>
                {cropPlotId===plot.id && <form onSubmit={createCrop} className="mt-2 grid gap-2 rounded-xl bg-surface-card p-3 shadow-sm"><Select name="crop" defaultValue="" required aria-label={t("cropName", lang)}><option value="" disabled>{t("cropName", lang)}</option>{CROPS.map((c)=><option key={c} value={c}>{t(CROP_KEYS[c], lang)}</option>)}</Select><Input name="date" type="date" required aria-label={t("plantedAtLabel", lang)} /><Button type="submit" loading={busy}>{t("submit", lang)}</Button></form>}
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/services" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-button border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-semibold text-accent hover:bg-brand-100"><Wrench className="h-4 w-4" /> {t("myFarmViewHarvester", lang)}</Link>
            <Link to="/market" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-button border border-surface-border-strong bg-surface-card px-4 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-100"><ShoppingBag className="h-4 w-4" /> {t("myFarmViewInputs", lang)}</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold text-stone-800"><Tractor className="h-6 w-6 text-brand-700" /> {t("myFarm", lang)}</h1>
        <Button onClick={() => setShowFarmForm((s) => !s)} aria-expanded={showFarmForm} className="min-h-[44px]">+ {t("addFarm", lang)}</Button>
      </div>

      {/* The farm list is the page's primary read; when it fails the other blocks
          keep whatever they have and this retry refetches that resource alone. */}
      <BlockError error={farmsRes.error} retryLabel={t("retry", lang)} onRetry={() => void farmsRes.reload()} />

      {showFarmForm && <Card><form onSubmit={createFarm} noValidate className="grid gap-3 sm:grid-cols-3"><div><Label htmlFor="fm-name">{t("farmNamePh", lang)}</Label><Input id="fm-name" name="name" aria-invalid={Boolean(formErrs.name)} aria-describedby={formErrs.name ? "fm-name-err" : undefined} /><p id="fm-name-err" role="alert" className="text-xs text-danger-text">{formErrs.name}</p></div><div><Label htmlFor="fm-district">{t("districtPh", lang)}</Label><Input id="fm-district" name="district" /></div><div><Label htmlFor="fm-area">{t("areaBigha", lang)}</Label><Input id="fm-area" name="area" type="number" step="0.1" min="0.1" /></div><Button type="submit" className="sm:col-span-3" loading={busy}>{t("save", lang)}</Button></form></Card>}

      {farmsRes.loading && <Card><Skeleton className="h-24 w-full" /></Card>}

      {!farmsRes.loading && !farmsRes.error && farms.length === 0 && !showFarmForm && <EmptyState icon={<Tractor className="h-7 w-7 text-brand-600" />} title={t("noFarmsYet", lang)} description={t("myFarmAddFarmHint", lang)} action={<Button onClick={() => setShowFarmForm(true)}>+ {t("addFarm", lang)}</Button>} />}

      {/* Intelligent Farm Overview */}
      {!farmsRes.loading && farms.length > 0 && (
        <section className="rounded-card border border-surface-border bg-surface-card p-5 shadow-card">
          <h2 className="text-base font-bold text-stone-800">{todayTasks.length === 1 ? t("myFarmCareOne", lang, { n: todayTasks.length }) : t("myFarmCareMany", lang, { n: todayTasks.length })}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-chip border border-danger-border bg-danger-bg px-3 py-1 text-xs font-semibold text-danger-text"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-enterprise-critical" /> {t("careUrgent", lang)} — {todayTasks.filter((task)=>task.care.tone==="danger").length}</span>
            <span className="inline-flex items-center gap-1.5 rounded-chip border border-warning-border bg-warning-bg px-3 py-1 text-xs font-semibold text-warning-text"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-enterprise-warning" /> {t("careDueToday", lang)} — {todayTasks.filter((task)=>task.care.tone==="warning").length}</span>
            <span className="inline-flex items-center gap-1.5 rounded-chip border border-success-border bg-success-bg px-3 py-1 text-xs font-semibold text-success-text"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-500" /> {t("careRoutine", lang)}</span>
          </div>
        </section>
      )}

      {/* Today's Tasks — most important */}
      {!farmsRes.loading && todayTasks.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-bold text-stone-800"><CalendarClock className="h-5 w-5 text-brand-700" /> {t("todayTasks", lang)}</h2>
          <div className="grid gap-3">
            {todayTasks.map((task) => (
              <Card key={task.id} className="flex items-start gap-3 border-l-4 border-l-action">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-iconBox bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100"><Sprout className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-link">{task.farmName} • {task.plotName} — {cropLabel(task.cropName, lang)}</p>
                  <p className="mt-0.5 text-sm font-semibold text-stone-800">{task.care.task}</p>
                  <p className="text-xs text-stone-600">{task.care.label} • {stageLabel(task.stage, lang)} • {new Date(task.plantedAt).toLocaleDateString(dateLocale(lang))}</p>
                </div>
                <span className={`shrink-0 rounded-chip border px-2 py-1 text-xs font-bold ${careToneClass(task.care.tone)}`}>{task.care.label}</span>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Tomorrow + Upcoming */}
      {!farmsRes.loading && farms.length > 0 && (
        <section className="rounded-card border border-surface-border bg-surface-card p-5 shadow-card">
          <h2 className="text-base font-bold text-stone-800">{t("myFarmTomorrowTitle", lang)}</h2>
          <p className="mt-1 text-sm text-stone-600">{t("myFarmTomorrowBody", lang)}</p>
          <div className="mt-3 space-y-2">
            {farms.flatMap((f)=>f.plots.flatMap((p)=>p.cropCycles)).slice(0,2).map((c)=> (
              <div key={c.id} className="flex items-center justify-between rounded-xl bg-surface-subdued px-3 py-2">
                <span className="text-sm font-medium text-stone-800">{cropLabel(c.cropName, lang)} — {stageLabel(c.stage, lang)}</span>
                <span className="text-xs text-stone-600">{new Date(c.plantedAt).toLocaleDateString(dateLocale(lang))}</span>
              </div>
            ))}
            {farms.flatMap((f)=>f.plots.flatMap((p)=>p.cropCycles)).length===0 && <p className="text-sm text-stone-500">{t("myFarmNoUpcoming", lang)}</p>}
          </div>
        </section>
      )}

      {/* AI Farm Briefing — grounded */}
      {!farmsRes.loading && farms.length > 0 && (
        <section className="rounded-card border border-indigo-100 bg-enterprise-ai-light p-5 shadow-card">
          <h2 className="flex items-center gap-2 text-base font-bold text-stone-800"><Bot className="h-5 w-5 text-enterprise-ai" /> {t("myFarmAiTitle", lang)}</h2>
          <p className="mt-2 text-sm leading-6 text-stone-700">{t("myFarmAiLine", lang, { n: stats.crops })}</p>
          <p className="mt-2 text-xs text-stone-500">{t("myFarmAiDisclaimer", lang)}</p>
          {/* Risk title comes from the weather API as a {titleBn,titleEn} pair —
              server data, not UI copy, so it is selected by field, not the dictionary.
              Filtered through the shared actionableRisks(): `risks[0]` is not "the
              risk", it is merely the first advisory, and the provider's first entry
              is INFO-level reassurance ("Weather favourable"). Reading it raw put a
              favourable advisory inside an amber warning box with a warning icon,
              while Home — which filtered — reported no risk from the same payload. */}
          {firstRisk && (
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-warning-bg px-3 py-2 text-xs font-medium text-warning-text">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {lang === "bn" ? firstRisk.titleBn : firstRisk.titleEn}
            </p>
          )}
          {/* A failed weather read has to say so here. The briefing's risk row is
              the screen's "what needs attention" line, and with the read failed it
              simply disappeared — identical to a day with no risks, on advice. */}
          {weatherRes.error && (
            <div className="mt-3 space-y-2">
              <p className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-xs font-medium text-warning-text">
                <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                {t("weatherUnavailable", lang)}
              </p>
              <Button variant="outline" size="sm" onClick={() => void weatherRes.reload()}>
                {t("retry", lang)}
              </Button>
            </div>
          )}
        </section>
      )}

      {/* My Farm Overview Grid */}
      {!farmsRes.loading && farms.length > 0 && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card variant="static" className="text-center"><p className="text-2xl font-extrabold text-accent">{stats.crops}</p><p className="mt-0.5 flex items-center justify-center gap-1 text-xs text-stone-600"><Sprout className="h-3.5 w-3.5 text-brand-600" aria-hidden /> {t("myFarmActiveCropsStat", lang)}</p></Card>
          <Card variant="static" className="text-center"><p className="text-2xl font-extrabold text-accent">{stats.plots}</p><p className="mt-0.5 flex items-center justify-center gap-1 text-xs text-stone-600"><MapPin className="h-3.5 w-3.5 text-brand-600" aria-hidden /> {t("myFarmPlotsStat", lang)}</p></Card>
          <Card variant="static" className="text-center"><p className="text-2xl font-extrabold text-accent">{Number(stats.totalBigha.toFixed(1))}</p><p className="mt-0.5 flex items-center justify-center gap-1 text-xs text-stone-600"><ClipboardList className="h-3.5 w-3.5 text-brand-600" aria-hidden /> {t("totalLand", lang)}</p></Card>
          <Card variant="static" className="text-center"><p className="text-2xl font-extrabold text-accent">{stats.farms}</p><p className="mt-0.5 flex items-center justify-center gap-1 text-xs text-stone-600"><HomeIcon className="h-3.5 w-3.5 text-brand-600" aria-hidden /> {t("farms", lang)}</p></Card>
        </section>
      )}

      {/* Farm List */}
      {!farmsRes.loading && farms.length > 0 && (
        <section className="space-y-3">
          <h2 className="px-1 text-base font-bold text-stone-800">{t("myFarmListTitle", lang)}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {farms.map((farm) => {
              const activeCrops = farm.plots.flatMap((p)=>p.cropCycles).filter((c)=>c.status==="ACTIVE").length;
              return (
                <Card
                  key={farm.id}
                  className="cursor-pointer space-y-3 p-5"
                  // Click-anywhere still opens the farm, but only from the card's
                  // own surface. Without this guard, clicking the inline
                  // "add plot" form (rendered inside this Card) bubbled here and
                  // swapped the page to the detail view — measured in a browser:
                  // clicking the plot-name field destroyed the form and the farm
                  // detail appeared (`detailAppeared=true formStillThere=false`).
                  // The nested buttons already stopPropagation; form controls are
                  // matched by ancestor so the whole form is exempt.
                  //
                  // No `role="button"`/`tabIndex`/`onKeyDown`: a button's children
                  // are presentational, so the nested buttons and form inputs were
                  // invalid inside it, and the card also unmounted on activation and
                  // dropped focus to <body>. Keyboard and assistive-technology users
                  // get the same action from the real "view plots" button below.
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("button, a, input, select, textarea, label, form")) return;
                    setSelectedFarm(farm.id);
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-stone-800">{farm.name}</h3>
                      <p className="text-xs text-stone-600">{[farm.district, farm.totalAreaBigha ? `${farm.totalAreaBigha} ${t("bighaShort", lang)}` : null].filter(Boolean).join(" · ")}</p>
                    </div>
                    <span className={`shrink-0 rounded-chip border px-2.5 py-1 text-xs font-bold ${careToneClass(activeCrops>0 ? "success" : "warning")}`}>{activeCrops>0? t("myFarmStatusActive", lang) : t("myFarmNeedsAttention", lang)}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 rounded-chip bg-surface-subdued px-2.5 py-1 font-medium text-stone-600"><MapPin className="h-3 w-3" /> {farm.plots.length} {t("myFarmPlotCount", lang)}</span>
                    <span className="inline-flex items-center gap-1 rounded-chip bg-surface-subdued px-2.5 py-1 font-medium text-stone-600"><Leaf className="h-3 w-3" /> {activeCrops} {t("myFarmActiveCropsChip", lang)}</span>
                  </div>
                  {/* The "details ›" hint that sat here was a <span> styled like a
                      link — `text-link` plus a chevron — so it looked tappable but
                      was not a control; only the card's click-anywhere handler made
                      it do anything. The "view plots" button below performs that
                      same action, so the card offered one action twice and one of
                      the two affordances was fake. Removed: the button is the real,
                      focusable control. */}
                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={(e)=>{ e.stopPropagation(); setPlotFor(plotFor===farm.id?null:farm.id);}}>+ {t("addPlot", lang)}</Button>
                    <Button size="sm" className="flex-1" onClick={(e)=>{ e.stopPropagation(); setSelectedFarm(farm.id);}}>{t("myFarmViewPlots", lang)}</Button>
                  </div>
                  {plotFor===farm.id && <form onSubmit={(e)=>createPlot(e,farm.id)} noValidate className="grid gap-2 rounded-xl bg-surface-subdued p-3"><Input name="name" placeholder={t("plotNamePh", lang)} required aria-label={t("plotNamePh", lang)} /><Input name="area" type="number" step="0.1" min="0.1" placeholder={t("areaBigha", lang)} required aria-label={t("areaBigha", lang)} /><Input name="soil" placeholder={t("soilTypePh", lang)} aria-label={t("soilTypePh", lang)} /><Button type="submit" loading={busy}>{t("submit", lang)}</Button></form>}
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* Empty state for no farms handled above */}
    </div>
  );
}
