import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { t } from "../../lib/i18n";
import type { DictKey } from "../../lib/i18n";
import { cropLabel, stageLabel, farmCareSuggestion } from "../../lib/labels";
import { getWeatherCoords } from "../../lib/geo";
import { mapError } from "../../lib/errors-ui";
import { track } from "../../lib/analytics";
import { Leaf, MapPin, Tractor, CalendarClock, Sprout, Bot, Wrench, ShoppingBag, ChevronRight, TriangleAlert, ClipboardList, Home as HomeIcon } from "lucide-react";
import { Button, Card, EmptyState, ErrorBanner, Input, Label, Select, Skeleton, useToast } from "../../components/ui";

interface Farm {
  id: string;
  name: string;
  district?: string;
  totalAreaBigha?: number;
  plots: { id: string; name: string; areaBigha: number; cropCycles: { id: string; cropName: string; stage: string; plantedAt: string; status: string }[] }[];
}
interface WeatherAdvisory { type: string; titleBn: string; titleEn: string; }

const CROPS = ["RICE", "WHEAT", "JUTE", "MUSTARD", "MAIZE", "POTATO"] as const;
const CROP_KEYS: Record<string, DictKey> = { RICE: "cropRICE", WHEAT: "cropWHEAT", JUTE: "cropJUTE", MUSTARD: "cropMUSTARD", MAIZE: "cropMAIZE", POTATO: "cropPOTATO" };

/** Tailwind classes for a care-suggestion tone (single source: labels.ts tone). */
function careColor(tone: "danger" | "warning" | "success"): string {
  if (tone === "danger") return "bg-danger-bg text-danger-text border-danger-border";
  if (tone === "warning") return "bg-warning-bg text-warning-text border-warning-border";
  return "bg-success-bg text-success-text border-success-border";
}

export default function MyFarm() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const toast = useToast();
  const [farms, setFarms] = useState<Farm[]>([]);
  const [weather, setWeather] = useState<{ risks: WeatherAdvisory[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showFarmForm, setShowFarmForm] = useState(false);
  const [plotFor, setPlotFor] = useState<string | null>(null);
  const [cropPlotId, setCropPlotId] = useState<string | null>(null);
  const [selectedFarm, setSelectedFarm] = useState<string | null>(null);
  const [formErrs, setFormErrs] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const farmsData = await api<Farm[]>("GET", "/farms");
      setFarms(farmsData);
      try {
        const coords = await getWeatherCoords();
        const weatherData = await api<{ risks: WeatherAdvisory[] }>("GET", `/weather?lat=${coords.lat}&lng=${coords.lng}`);
        setWeather(weatherData as { risks: WeatherAdvisory[] });
      } catch {
        setWeather({ risks: [] });
      }
    } catch (err) {
      setLoadError(mapError(err, lang));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      track("farm_created"); toast.success(t("farmCreatedToast", lang)); setShowFarmForm(false); (e.target as HTMLFormElement).reset(); await load();
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
      toast.success(t("plotCreatedToast", lang)); setPlotFor(null); (e.target as HTMLFormElement).reset(); await load();
    } catch (err) { toast.error(mapError(err, lang)); } finally { setBusy(false); }
  }
  async function createCrop(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (!cropPlotId || !fd.get("crop") || !fd.get("date")) { toast.error(t("errFieldRequired", lang)); return; }
    setBusy(true);
    try {
      await api("POST", "/farms/crops", { plotId: cropPlotId, cropName: fd.get("crop"), plantedAt: new Date(fd.get("date") as string).toISOString() });
      toast.success(t("cropCreatedToast", lang)); setCropPlotId(null); (e.target as HTMLFormElement).reset(); await load();
    } catch (err) { toast.error(mapError(err, lang)); } finally { setBusy(false); }
  }

  if (farmDetail) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => setSelectedFarm(null)} className="inline-flex items-center gap-1 rounded text-sm font-medium text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]">← {t("back", lang)}</button>
        <div className="rounded-card border border-surface-border bg-surface-card p-5 shadow-card">
          <h2 className="text-lg font-bold text-stone-800">{farmDetail.name}</h2>
          <p className="text-xs text-stone-600">{[farmDetail.district, farmDetail.totalAreaBigha ? `${farmDetail.totalAreaBigha} ${t("bighaShort", lang)}` : null].filter(Boolean).join(" · ")} • {farmDetail.plots.length} {lang==="bn"?"প্লট":"plots"}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {farmDetail.plots.map((plot) => (
              <div key={plot.id} className="rounded-2xl border border-surface-border bg-surface-subdued p-4">
                <p className="flex items-center gap-1 text-sm font-semibold text-stone-800"><MapPin className="h-4 w-4 text-stone-500" /> {plot.name} ({plot.areaBigha} {t("bighaShort", lang)})</p>
                {plot.cropCycles.length > 0 ? plot.cropCycles.map((c) => {
                  const care = farmCareSuggestion(c, lang);
                  return (
                    <div key={c.id} className="mt-3 flex items-center gap-2 rounded-xl bg-surface-card px-3 py-2 shadow-sm">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100"><Leaf className="h-4 w-4" /></span>
                      <div className="min-w-0"><p className="text-sm font-semibold text-stone-800">{cropLabel(c.cropName, lang)} • {stageLabel(c.stage, lang)}</p><p className="text-xs text-stone-600">{new Date(c.plantedAt).toLocaleDateString(lang==="bn"?"bn-BD":"en-GB")} • {care.task}</p></div>
                      <span className={`ml-auto shrink-0 rounded-chip border px-2 py-0.5 text-xs font-semibold ${careColor(care.tone)}`}>{care.label}</span>
                    </div>
                  );
                }) : <p className="mt-2 text-xs text-stone-500">{t("noPlotsYet", lang)}</p>}
                <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => setCropPlotId(cropPlotId===plot.id?null:plot.id)}>+ {t("addCrop", lang)}</Button>
                {cropPlotId===plot.id && <form onSubmit={createCrop} className="mt-2 grid gap-2 rounded-xl bg-surface-card p-3 shadow-sm"><Select name="crop" defaultValue="" required aria-label={t("cropName", lang)}><option value="" disabled>{t("cropName", lang)}</option>{CROPS.map((c)=><option key={c} value={c}>{t(CROP_KEYS[c], lang)}</option>)}</Select><Input name="date" type="date" required aria-label={t("plantedAtLabel", lang)} /><Button type="submit" loading={busy}>{t("submit", lang)}</Button></form>}
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/services" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-button border border-brand-200 bg-brand-50 px-4 py-2 text-sm font-semibold text-accent hover:bg-brand-100"><Wrench className="h-4 w-4" /> {lang==="bn"?"হারভেস্টার দেখুন":"View harvester"}</Link>
            <Link to="/market" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-button border border-surface-border-strong bg-surface-card px-4 py-2 text-sm font-semibold text-stone-800 hover:bg-stone-100"><ShoppingBag className="h-4 w-4" /> {lang==="bn"?"ইনপুট দেখুন":"View inputs"}</Link>
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

      {loadError && <div className="space-y-2"><ErrorBanner message={loadError} /><Button variant="outline" onClick={() => void load()}>{t("retry", lang)}</Button></div>}

      {showFarmForm && <Card><form onSubmit={createFarm} noValidate className="grid gap-3 sm:grid-cols-3"><div><Label htmlFor="fm-name">{t("farmNamePh", lang)}</Label><Input id="fm-name" name="name" aria-invalid={Boolean(formErrs.name)} /><p role="alert" className="text-xs text-danger-text">{formErrs.name}</p></div><div><Label htmlFor="fm-district">{t("districtPh", lang)}</Label><Input id="fm-district" name="district" /></div><div><Label htmlFor="fm-area">{t("areaBigha", lang)}</Label><Input id="fm-area" name="area" type="number" step="0.1" min="0.1" /></div><Button type="submit" className="sm:col-span-3" loading={busy}>{t("save", lang)}</Button></form></Card>}

      {loading && !loadError && <Card><Skeleton className="h-24 w-full" /></Card>}

      {!loading && !loadError && farms.length === 0 && !showFarmForm && <EmptyState icon={<Tractor className="h-7 w-7 text-brand-600" />} title={t("noFarmsYet", lang)} description={lang==="bn"?"আপনার খামার যোগ করে ফসল ও কাজ এক জায়গায় পরিচালনা করুন।":"Add your farm to manage crops and tasks in one place."} action={<Button onClick={() => setShowFarmForm(true)}>+ {t("addFarm", lang)}</Button>} />}

      {/* Intelligent Farm Overview */}
      {!loading && farms.length > 0 && (
        <section className="rounded-card border border-surface-border bg-surface-card p-5 shadow-card">
          <h2 className="text-base font-bold text-stone-800">{lang==="bn"?`আজ আপনার খামারে ${todayTasks.length}টি ফসলের পরামর্শ আছে`:`You have ${todayTasks.length} farm care suggestion${todayTasks.length===1?"":"s"} today`}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-chip border border-danger-border bg-danger-bg px-3 py-1 text-xs font-semibold text-danger-text"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-enterprise-critical" /> {t("careUrgent", lang)} — {todayTasks.filter((task)=>task.care.tone==="danger").length}</span>
            <span className="inline-flex items-center gap-1.5 rounded-chip border border-warning-border bg-warning-bg px-3 py-1 text-xs font-semibold text-warning-text"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-enterprise-warning" /> {t("careDueToday", lang)} — {todayTasks.filter((task)=>task.care.tone==="warning").length}</span>
            <span className="inline-flex items-center gap-1.5 rounded-chip border border-success-border bg-success-bg px-3 py-1 text-xs font-semibold text-success-text"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-brand-500" /> {t("careRoutine", lang)}</span>
          </div>
        </section>
      )}

      {/* Today's Tasks — most important */}
      {!loading && todayTasks.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-base font-bold text-stone-800"><CalendarClock className="h-5 w-5 text-brand-700" /> {lang==="bn"?"আজকের কাজ":"Today's tasks"}</h2>
          <div className="grid gap-3">
            {todayTasks.map((task) => (
              <Card key={task.id} className="flex items-start gap-3 border-l-4 border-l-action">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-iconBox bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100"><Sprout className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-link">{task.farmName} • {task.plotName} — {cropLabel(task.cropName, lang)}</p>
                  <p className="mt-0.5 text-sm font-semibold text-stone-800">{task.care.task}</p>
                  <p className="text-xs text-stone-600">{task.care.label} • {stageLabel(task.stage, lang)} • {new Date(task.plantedAt).toLocaleDateString(lang==="bn"?"bn-BD":"en-GB")}</p>
                </div>
                <span className={`shrink-0 rounded-chip border px-2 py-1 text-xs font-bold ${careColor(task.care.tone)}`}>{task.care.label}</span>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Tomorrow + Upcoming */}
      {!loading && farms.length > 0 && (
        <section className="rounded-card border border-surface-border bg-surface-card p-5 shadow-card">
          <h2 className="text-base font-bold text-stone-800">{lang==="bn"?"আগামীকাল ও আসন্ন":"Tomorrow & upcoming"}</h2>
          <p className="mt-1 text-sm text-stone-600">{lang==="bn"?"আগামীকালের কাজ ও পরবর্তী মাইলস্টোন দেখুন।":"See tomorrow's work and next milestones."}</p>
          <div className="mt-3 space-y-2">
            {farms.flatMap((f)=>f.plots.flatMap((p)=>p.cropCycles)).slice(0,2).map((c)=> (
              <div key={c.id} className="flex items-center justify-between rounded-xl bg-surface-subdued px-3 py-2">
                <span className="text-sm font-medium text-stone-800">{cropLabel(c.cropName, lang)} — {stageLabel(c.stage, lang)}</span>
                <span className="text-xs text-stone-600">{new Date(c.plantedAt).toLocaleDateString(lang==="bn"?"bn-BD":"en-GB")}</span>
              </div>
            ))}
            {farms.flatMap((f)=>f.plots.flatMap((p)=>p.cropCycles)).length===0 && <p className="text-sm text-stone-500">{lang==="bn"?"কোনো আসন্ন কাজ নেই।":"No upcoming tasks."}</p>}
          </div>
        </section>
      )}

      {/* AI Farm Briefing — grounded */}
      {!loading && farms.length > 0 && (
        <section className="rounded-card border border-indigo-100 bg-enterprise-ai-light p-5 shadow-card">
          <h2 className="flex items-center gap-2 text-base font-bold text-stone-800"><Bot className="h-5 w-5 text-enterprise-ai" /> {lang==="bn"?"আমার ফার্ম AI":"My Farm AI"}</h2>
          <p className="mt-2 text-sm leading-6 text-stone-700">{lang==="bn"?`আজ আপনার ${stats.crops}টি সক্রিয় ফসলের পর্যায়ে অনুযায়ী পরামর্শ নিচে দেওয়া হলো।`:`${stats.crops} active crops — stage-based suggestions below.`}</p>
          <p className="mt-2 text-xs text-stone-500">{lang==="bn"?"পর্যায়-ভিত্তিক পরামর্শ (সাজেস্টশন — বিশেষজ্ঞের পরামর্শ নয়)।":"Stage-based suggestion — guidance, not an expert diagnosis."}</p>
          {weather?.risks?.[0] && <p className="mt-3 flex items-start gap-2 rounded-xl bg-warning-bg px-3 py-2 text-xs font-medium text-warning-text"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {lang==="bn"?weather.risks[0].titleBn:weather.risks[0].titleEn}</p>}
        </section>
      )}

      {/* My Farm Overview Grid */}
      {!loading && farms.length > 0 && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card variant="static" className="text-center"><p className="text-2xl font-extrabold text-accent">{stats.crops}</p><p className="mt-0.5 flex items-center justify-center gap-1 text-xs text-stone-600"><Sprout className="h-3.5 w-3.5 text-brand-600" aria-hidden /> {lang==="bn"?"সক্রিয় ফসল":"Active crops"}</p></Card>
          <Card variant="static" className="text-center"><p className="text-2xl font-extrabold text-accent">{stats.plots}</p><p className="mt-0.5 flex items-center justify-center gap-1 text-xs text-stone-600"><MapPin className="h-3.5 w-3.5 text-brand-600" aria-hidden /> {lang==="bn"?"প্লট":"Plots"}</p></Card>
          <Card variant="static" className="text-center"><p className="text-2xl font-extrabold text-accent">{Number(stats.totalBigha.toFixed(1))}</p><p className="mt-0.5 flex items-center justify-center gap-1 text-xs text-stone-600"><ClipboardList className="h-3.5 w-3.5 text-brand-600" aria-hidden /> {t("totalLand", lang)}</p></Card>
          <Card variant="static" className="text-center"><p className="text-2xl font-extrabold text-accent">{stats.farms}</p><p className="mt-0.5 flex items-center justify-center gap-1 text-xs text-stone-600"><HomeIcon className="h-3.5 w-3.5 text-brand-600" aria-hidden /> {lang==="bn"?"ফার্ম":"Farms"}</p></Card>
        </section>
      )}

      {/* Farm List */}
      {!loading && farms.length > 0 && (
        <section className="space-y-3">
          <h2 className="px-1 text-base font-bold text-stone-800">{lang==="bn"?"আমার খামার তালিকা":"My farms"}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {farms.map((farm) => {
              const activeCrops = farm.plots.flatMap((p)=>p.cropCycles).filter((c)=>c.status==="ACTIVE").length;
              return (
                <Card key={farm.id} className="cursor-pointer space-y-3 p-5" onClick={() => setSelectedFarm(farm.id)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-base font-bold text-stone-800">{farm.name}</h3>
                      <p className="text-xs text-stone-600">{[farm.district, farm.totalAreaBigha ? `${farm.totalAreaBigha} ${t("bighaShort", lang)}` : null].filter(Boolean).join(" · ")}</p>
                    </div>
                    <span className={`shrink-0 rounded-chip border px-2.5 py-1 text-xs font-bold ${activeCrops>0?"bg-success-bg text-success-text border-success-border":"bg-warning-bg text-warning-text border-warning-border"}`}>{activeCrops>0? (lang==="bn"?"সচল":"Active") : (lang==="bn"?"নজর দিন":"Needs attention")}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 rounded-chip bg-surface-subdued px-2.5 py-1 font-medium text-stone-600"><MapPin className="h-3 w-3" /> {farm.plots.length} {lang==="bn"?"প্লট":"plots"}</span>
                    <span className="inline-flex items-center gap-1 rounded-chip bg-surface-subdued px-2.5 py-1 font-medium text-stone-600"><Leaf className="h-3 w-3" /> {activeCrops} {lang==="bn"?"সক্রিয় ফসল":"active crops"}</span>
                  </div>
                  <div className="flex items-center justify-end">
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-link">{lang==="bn"?"বিস্তারিত":"Details"} <ChevronRight className="h-3 w-3" /></span>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={(e)=>{ e.stopPropagation(); setPlotFor(plotFor===farm.id?null:farm.id);}}>+ {t("addPlot", lang)}</Button>
                    <Button size="sm" className="flex-1" onClick={(e)=>{ e.stopPropagation(); setSelectedFarm(farm.id);}}>{lang==="bn"?"প্লট দেখুন":"View plots"}</Button>
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
