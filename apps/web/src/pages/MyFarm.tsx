import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";
import type { DictKey } from "../lib/i18n.js";
import { cropLabel, stageLabel } from "../lib/labels.js";
import { mapError } from "../lib/errors-ui.js";
import { track } from "../lib/analytics.js";
import { Leaf, MapPin, Tractor, CalendarClock, AlertTriangle, Sprout, Droplets, Sun, CloudRain, Bot, Wrench, ShoppingBag, ChevronRight, Plus, Clock } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, Label, Select, Skeleton, useToast } from "../components/ui.jsx";

const STAGES = ["SEED", "GERMINATION", "VEGETATIVE", "FLOWERING", "GRAIN_FRUIT_DEVELOPMENT", "HARVEST"] as const;
function cropStageFor(plantedAt: string | Date, now = new Date()): string {
  const d = Math.floor((new Date(now).getTime() - new Date(plantedAt).getTime()) / 86400000);
  if (d <= 7) return STAGES[0];
  if (d <= 20) return STAGES[1];
  if (d <= 45) return STAGES[2];
  if (d <= 70) return STAGES[3];
  if (d <= 100) return STAGES[4];
  return STAGES[5];
}
function cropCalendar(stage: string): { taskEn: string; taskBn: string }[] {
  switch (stage) {
    case "SEED": return [{ taskEn: "Ensure seedbed moisture", taskBn: "বীজতলার আর্দ্রতা নিশ্চিত করুন" }];
    case "GERMINATION": return [{ taskEn: "Gap filling", taskBn: "গ্যাপ পূরণ" }];
    case "VEGETATIVE": return [{ taskEn: "Urea top dressing", taskBn: "ইউরিয়া সেচ" }];
    case "FLOWERING": return [{ taskEn: "Maintain moisture", taskBn: "আর্দ্রতা বজায় রাখুন" }];
    case "GRAIN_FRUIT_DEVELOPMENT": return [{ taskEn: "Potash top-up", taskBn: "পটাশ দিন" }];
    default: return [{ taskEn: "Plan harvest", taskBn: "কাটাকুটি ব্যবস্থা করুন" }];
  }
}

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

function priorityForCycle(c: { stage: string; plantedAt: string }): { label: string; color: string; task: string } {
  const stage = c.stage;
  const days = Math.floor((Date.now() - new Date(c.plantedAt).getTime()) / 86400000);
  if (stage === "SEED" && days > 5) return { label: "জরুরি", color: "bg-red-100 text-red-700 border-red-200", task: "বীজতলার আর্দ্রতা পরীক্ষা করুন" };
  if (stage === "VEGETATIVE" && days > 30) return { label: "আজ করতে হবে", color: "bg-amber-100 text-amber-800 border-amber-200", task: "ইউরিয়া সেচ দিন" };
  return { label: "রুটিন", color: "bg-emerald-50 text-emerald-700 border-emerald-200", task: cropCalendar(stage)[0]?.taskBn ?? "পরবর্তী কাজ দেখুন" };
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

  async function getWeatherCoords(): Promise<{ lat: number; lng: number }> {
    // Try browser geolocation first (user's actual location), fall back to Rangpur default
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3000, maximumAge: 300000 })
        );
        return { lat: pos.coords.latitude, lng: pos.coords.longitude };
      } catch {
        // fall through to default
      }
    }
    return { lat: 25.9, lng: 89.1 };
  }

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
  useEffect(() => { void load(); }, []);

  const stats = useMemo(() => {
    const plots = farms.flatMap((f) => f.plots);
    const cycles = plots.flatMap((p) => p.cropCycles.filter((c) => c.status === "ACTIVE"));
    const pendingTasks = cycles.length * 2;
    return { farms: farms.length, plots: plots.length, crops: cycles.length, pendingTasks };
  }, [farms]);

  const todayTasks = useMemo(() => {
    const cycles = farms.flatMap((f) => f.plots.flatMap((p) => p.cropCycles.filter((c) => c.status === "ACTIVE").map((c) => ({ ...c, plotName: p.name, farmName: f.name, farmId: f.id }))));
    return cycles.slice(0, 3).map((c) => ({ ...c, ...priorityForCycle(c) }));
  }, [farms]);

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
        <button type="button" onClick={() => setSelectedFarm(null)} className="inline-flex items-center gap-1 text-sm font-medium text-[#15803D] hover:underline">← {t("back", lang)}</button>
        <div className="rounded-[20px] border border-[#E7E5E4] bg-white p-5 shadow-card">
          <h2 className="text-[18px] font-bold text-[#1A1F1C]">{farmDetail.name}</h2>
          <p className="text-xs text-[#57534E]">{[farmDetail.district, farmDetail.totalAreaBigha ? `${farmDetail.totalAreaBigha} ${t("bighaShort", lang)}` : null].filter(Boolean).join(" · ")} • {farmDetail.plots.length} {lang==="bn"?"প্লট":"plots"}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {farmDetail.plots.map((plot) => (
              <div key={plot.id} className="rounded-[16px] border border-[#E7E5E4] bg-[#F8FAF5] p-4">
                <p className="flex items-center gap-1 text-sm font-semibold text-[#1A1F1C]"><MapPin className="h-4 w-4 text-[#78716C]" /> {plot.name} ({plot.areaBigha} {t("bighaShort", lang)})</p>
                {plot.cropCycles.length > 0 ? plot.cropCycles.map((c) => (
                  <div key={c.id} className="mt-3 flex items-center gap-2 rounded-[12px] bg-white px-3 py-2 shadow-sm">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#DCFCE7] text-[#15803D]"><Leaf className="h-4 w-4" /></span>
                    <div className="min-w-0"><p className="text-[13px] font-semibold text-[#1A1F1C]">{cropLabel(c.cropName, lang)} • {stageLabel(c.stage, lang)}</p><p className="text-[11px] text-[#57534E]">{new Date(c.plantedAt).toLocaleDateString(lang==="bn"?"bn-BD":"en-GB")} • {priorityForCycle(c).task}</p></div>
                    <span className={`ml-auto rounded-full border px-2 py-0.5 text-[11px] font-semibold ${priorityForCycle(c).color}`}>{priorityForCycle(c).label}</span>
                  </div>
                )) : <p className="mt-2 text-xs text-[#78716C]">{t("noPlotsYet", lang)}</p>}
                <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => setCropPlotId(cropPlotId===plot.id?null:plot.id)}>+ {t("addCrop", lang)}</Button>
                {cropPlotId===plot.id && <form onSubmit={createCrop} className="mt-2 grid gap-2 rounded-[12px] bg-white p-3 shadow-sm"><Select name="crop" defaultValue="" required><option value="" disabled>{t("cropName", lang)}</option>{CROPS.map((c)=><option key={c} value={c}>{t(CROP_KEYS[c], lang)}</option>)}</Select><Input name="date" type="date" required /><Button type="submit" loading={busy}>{t("submit", lang)}</Button></form>}
              </div>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/services" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[12px] border border-[#DCFCE7] bg-[#F0FDF4] px-4 py-2 text-[13px] font-semibold text-[#14532D] hover:bg-[#DCFCE7]"><Wrench className="h-4 w-4" /> {lang==="bn"?"হারভেস্টার দেখুন":"View harvester"}</Link>
            <Link to="/market" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[12px] border border-[#E7E5E4] bg-white px-4 py-2 text-[13px] font-semibold text-[#14532D] hover:bg-[#F8FAF5]"><ShoppingBag className="h-4 w-4" /> {lang==="bn"?"ইনপুট দেখুন":"View inputs"}</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold text-[#1A1F1C]"><Tractor className="h-6 w-6 text-[#15803D]" /> {t("myFarm", lang)}</h1>
        <Button onClick={() => setShowFarmForm((s) => !s)} aria-expanded={showFarmForm} className="min-h-[44px]">+ {t("addFarm", lang)}</Button>
      </div>

      {loadError && <div className="space-y-2"><ErrorBanner message={loadError} /><Button variant="outline" onClick={() => void load()}>{t("retry", lang)}</Button></div>}

      {showFarmForm && <Card><form onSubmit={createFarm} noValidate className="grid gap-3 sm:grid-cols-3"><div><Label htmlFor="fm-name">{t("farmNamePh", lang)}</Label><Input id="fm-name" name="name" aria-invalid={Boolean(formErrs.name)} /><p role="alert" className="text-xs text-red-600">{formErrs.name}</p></div><div><Label htmlFor="fm-district">{t("districtPh", lang)}</Label><Input id="fm-district" name="district" /></div><div><Label htmlFor="fm-area">{t("areaBigha", lang)}</Label><Input id="fm-area" name="area" type="number" step="0.1" min="0.1" /></div><Button type="submit" className="sm:col-span-3" loading={busy}>{t("save", lang)}</Button></form></Card>}

      {loading && !loadError && <Card><Skeleton className="h-24 w-full" /></Card>}

      {!loading && !loadError && farms.length === 0 && !showFarmForm && <EmptyState icon={<Tractor className="h-10 w-10 text-stone-300" />} title={t("noFarmsYet", lang)} description={lang==="bn"?"আপনার খামার যোগ করে ফসল ও কাজ এক জায়গায় পরিচালনা করুন।":"Add your farm to manage crops and tasks in one place."} action={<Button onClick={() => setShowFarmForm(true)}>+ {t("addFarm", lang)}</Button>} />}

      {/* Intelligent Farm Overview */}
      {!loading && farms.length > 0 && (
        <section className="rounded-[20px] border border-[#E7E5E4] bg-white p-5 shadow-card">
          <h2 className="text-[16px] font-bold text-[#1A1F1C]">{lang==="bn"?"আজ আপনার খামারে ৩টি গুরুত্বপূর্ণ কাজ আছে":"You have 3 important tasks on your farm today"}</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">🔴 {lang==="bn"?"জরুরি":"Urgent"} — {todayTasks.filter((t)=>t.label==="জরুরি").length}</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">🟡 {lang==="bn"?"আজ করতে হবে":"Due today"} — {todayTasks.filter((t)=>t.label==="আজ করতে হবে").length}</span>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">🟢 {lang==="bn"?"সব ঠিক":"All good"}</span>
          </div>
        </section>
      )}

      {/* Today's Tasks — most important */}
      {!loading && todayTasks.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-[16px] font-bold text-[#1A1F1C]"><CalendarClock className="h-5 w-5 text-[#15803D]" /> {lang==="bn"?"আজকের কাজ":"Today's tasks"}</h2>
          <div className="grid gap-3">
            {todayTasks.map((task) => (
              <Card key={task.id} className="flex items-start gap-3 border-l-4 border-l-[#15803D]">
                <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#F0FDF4] text-[#15803D]"><Sprout className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-[#15803D]">{task.farmName} • {task.plotName} — {cropLabel(task.cropName, lang)}</p>
                  <p className="mt-0.5 text-[14px] font-semibold text-[#1A1F1C]">{task.task}</p>
                  <p className="text-xs text-[#57534E]">{task.label} • {task.stage} • {new Date(task.plantedAt).toLocaleDateString(lang==="bn"?"bn-BD":"en-GB")}</p>
                </div>
                <span className={`shrink-0 rounded-full border px-2 py-1 text-[11px] font-bold ${task.color}`}>{task.label}</span>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Tomorrow + Upcoming */}
      {!loading && farms.length > 0 && (
        <section className="rounded-[20px] border border-[#E7E5E4] bg-white p-5 shadow-card">
          <h2 className="text-[16px] font-bold text-[#1A1F1C]">{lang==="bn"?"আগামীকাল ও আসন্ন":"Tomorrow & upcoming"}</h2>
          <p className="mt-1 text-[13px] text-[#57534E]">{lang==="bn"?"আগামীকালের কাজ ও পরবর্তী মাইলস্টোন দেখুন।":"See tomorrow's work and next milestones."}</p>
          <div className="mt-3 space-y-2">
            {farms.flatMap((f)=>f.plots.flatMap((p)=>p.cropCycles)).slice(0,2).map((c)=> (
              <div key={c.id} className="flex items-center justify-between rounded-[12px] bg-[#F8FAF5] px-3 py-2">
                <span className="text-[13px] font-medium text-[#1A1F1C]">{cropLabel(c.cropName, lang)} — {stageLabel(c.stage, lang)}</span>
                <span className="text-xs text-[#57534E]">{new Date(c.plantedAt).toLocaleDateString(lang==="bn"?"bn-BD":"en-GB")}</span>
              </div>
            ))}
            {farms.flatMap((f)=>f.plots.flatMap((p)=>p.cropCycles)).length===0 && <p className="text-sm text-[#78716C]">{lang==="bn"?"কোনো আসন্ন কাজ নেই।":"No upcoming tasks."}</p>}
          </div>
        </section>
      )}

      {/* AI Farm Briefing — grounded */}
      {!loading && farms.length > 0 && (
        <section className="rounded-[20px] border border-[#E0E7FF] bg-gradient-to-br from-[#EEF2FF] via-white to-[#F0FDF4] p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-[16px] font-bold text-[#1E1B4B]"><Bot className="h-5 w-5 text-[#4F46E5]" /> {lang==="bn"?"আমার ফার্ম AI":"My Farm AI"}</h2>
          <p className="mt-2 text-[13px] leading-6 text-[#334155]">{lang==="bn"?`আজ আপনার ${stats.crops}টি ফসলে নজর দেওয়া প্রয়োজন। ${todayTasks[0]?.task ?? "পরবর্তী কাজগুলো schedule অনুযায়ী দেখুন।"}`:`${stats.crops} crops need attention today. ${todayTasks[0]?.task ?? "Check the schedule for next steps."}`}</p>
          <p className="mt-2 text-[11px] text-[#64748B]">{lang==="bn"?"AI পরামর্শ — আবহাওয়া ও পর্যায় অনুযায়ী।":"AI advisory — based on weather and stage."}</p>
          {weather?.risks?.[0] && <p className="mt-3 rounded-[12px] bg-amber-50 px-3 py-2 text-[12px] font-medium text-amber-800">⚠️ {lang==="bn"?weather.risks[0].titleBn:weather.risks[0].titleEn}</p>}
        </section>
      )}

      {/* My Farm Overview Grid */}
      {!loading && farms.length > 0 && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card className="text-center"><p className="text-2xl font-extrabold text-[#14532D]">{stats.crops}</p><p className="text-xs text-[#57534E]">🌾 {lang==="bn"?"সক্রিয় ফসল":"Active crops"}</p></Card>
          <Card className="text-center"><p className="text-2xl font-extrabold text-[#14532D]">{stats.plots}</p><p className="text-xs text-[#57534E]">📍 {lang==="bn"?"প্লট":"Plots"}</p></Card>
          <Card className="text-center"><p className="text-2xl font-extrabold text-[#14532D]">{stats.pendingTasks}</p><p className="text-xs text-[#57534E]">📋 {lang==="bn"?"অপেক্ষমাণ কাজ":"Pending tasks"}</p></Card>
          <Card className="text-center"><p className="text-2xl font-extrabold text-[#14532D]">{stats.farms}</p><p className="text-xs text-[#57534E]">🏡 {lang==="bn"?"ফার্ম":"Farms"}</p></Card>
        </section>
      )}

      {/* Farm List — redesigned cards */}
      {!loading && farms.length > 0 && (
        <section className="space-y-3">
          <h2 className="px-1 text-[16px] font-bold text-[#1A1F1C]">{lang==="bn"?"আমার খামার তালিকা":"My farms"}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {farms.map((farm) => {
              const activeCrops = farm.plots.flatMap((p)=>p.cropCycles).filter((c)=>c.status==="ACTIVE").length;
              return (
                <Card key={farm.id} className="cursor-pointer space-y-3 p-5 hover:border-[#15803D]/30 hover:shadow-md transition-shadow" onClick={() => setSelectedFarm(farm.id)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-[16px] font-bold text-[#1A1F1C]">{farm.name}</h3>
                      <p className="text-xs text-[#57534E]">{[farm.district, farm.totalAreaBigha ? `${farm.totalAreaBigha} ${t("bighaShort", lang)}` : null].filter(Boolean).join(" · ")}</p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold ${activeCrops>0?"bg-emerald-50 text-emerald-700 border-emerald-200":"bg-amber-50 text-amber-800 border-amber-200"}`}>{activeCrops>0? (lang==="bn"?"সচল":"Active") : (lang==="bn"?"নজর দিন":"Needs attention")}</span>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#F8FAF5] px-2.5 py-1 font-medium text-[#57534E]"><MapPin className="h-3 w-3" /> {farm.plots.length} {lang==="bn"?"প্লট":"plots"}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#F8FAF5] px-2.5 py-1 font-medium text-[#57534E]"><Leaf className="h-3 w-3" /> {activeCrops} {lang==="bn"?"সক্রিয় ফসল":"active crops"}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#78716C]">{lang==="bn"?"আগামী কাজ: সার প্রয়োগ":"Next: fertilizer"}</span>
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#15803D]">{lang==="bn"?"বিস্তারিত":"Details"} <ChevronRight className="h-3 w-3" /></span>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={(e)=>{ e.stopPropagation(); setPlotFor(plotFor===farm.id?null:farm.id);}}>+ {t("addPlot", lang)}</Button>
                    <Button size="sm" className="flex-1" onClick={(e)=>{ e.stopPropagation(); setSelectedFarm(farm.id);}}>{lang==="bn"?"প্লট দেখুন":"View plots"}</Button>
                  </div>
                  {plotFor===farm.id && <form onSubmit={(e)=>createPlot(e,farm.id)} noValidate className="grid gap-2 rounded-[12px] bg-[#F8FAF5] p-3"><Input name="name" placeholder={t("plotNamePh", lang)} required /><Input name="area" type="number" step="0.1" min="0.1" placeholder={t("areaBigha", lang)} required /><Input name="soil" placeholder={t("soilTypePh", lang)} /><Button type="submit" loading={busy}>{t("submit", lang)}</Button></form>}
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
