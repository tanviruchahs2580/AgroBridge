import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";
import { formatBDT, formatDateTime } from "../lib/format.js";
import { bookingStatusLabel } from "../lib/labels.js";
import { mapError } from "../lib/errors-ui.js";
import { track } from "../lib/analytics.js";
import { ClipboardList, Search, SlidersHorizontal, Tractor, TriangleAlert, X } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, Label, Select, Skeleton, useConfirm, useToast } from "../components/ui.jsx";
import { ServiceCard, ServiceCardSkeleton } from "../components/service/ServiceCard.jsx";

interface Service {
  id: string;
  code: string;
  name: string;
  category: string;
  basePricePaisa: number;
  priceUnit: string;
  description?: string;
  providers: { id: string; name: string; district?: string; ratingCount: number; ratingSum?: number }[];
}
interface Booking {
  id: string;
  bookingNo: string;
  status: string;
  scheduledFor: string;
  areaBigha: number;
  estimatedPricePaisa: number;
  service?: { name: string; category: string };
  farm?: { name: string };
  provider?: { name: string } | null;
}

// Category grouping for filter chips — Gap Analysis §4.8
type FilterKey = "ALL" | "MECH" | "ADVISORY" | "TEST";
const FILTER_MAP: Record<FilterKey, string[]> = {
  ALL: [],
  MECH: ["TRACTOR", "COMBINE_HARVESTER", "POWER_TILLER", "THRESHER", "LAND_LEVELLER"],
  ADVISORY: ["AGRONOMIST", "DRONE"],
  TEST: ["SOIL_TESTING"],
};
const CHIP_LABEL: Record<FilterKey, string> = {
  ALL: "সব",
  MECH: "যন্ত্রপাতি",
  ADVISORY: "পরামর্শ",
  TEST: "পরীক্ষা",
};

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.07, delayChildren: 0.12 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 340, damping: 28 } },
};

export default function Services() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const toast = useToast();
  const confirm = useConfirm();

  const [services, setServices] = useState<Service[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [farms, setFarms] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formErrs, setFormErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("ALL");
  const [sort, setSort] = useState<"default" | "priceAsc" | "priceDesc">("default");

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [svc, bkg, frm] = await Promise.all([
        api<Service[]>("GET", "/services"),
        api<Booking[]>("GET", "/bookings"),
        api<{ id: string; name: string }[]>("GET", "/farms"),
      ]);
      setServices(svc);
      setBookings(bkg);
      setFarms(frm);
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

  const filtered = useMemo(() => {
    let out = services.filter((s) => {
      const cats = FILTER_MAP[activeFilter];
      const matchesFilter = activeFilter === "ALL" || cats.includes(s.category);
      const q = query.trim().toLowerCase();
      const matchesQ = !q || s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q);
      return matchesFilter && matchesQ;
    });
    if (sort === "priceAsc") out = [...out].sort((a, b) => a.basePricePaisa - b.basePricePaisa);
    if (sort === "priceDesc") out = [...out].sort((a, b) => b.basePricePaisa - a.basePricePaisa);
    return out;
  }, [services, activeFilter, query, sort]);

  async function book(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const fd = new FormData(e.currentTarget);
    const errs: Record<string, string> = {};
    if (!fd.get("farm")) errs.farm = t("errFieldRequired", lang);
    const dateStr = fd.get("date") as string;
    if (!dateStr) errs.date = t("errFieldRequired", lang);
    else if (new Date(dateStr).getTime() < Date.now() - 60_000) errs.date = t("errDateFuture", lang);
    const area = Number(fd.get("area"));
    if (!area || area <= 0) errs.area = t("errAreaInvalid", lang);
    setFormErrs(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    try {
      await api("POST", "/bookings", {
        farmId: fd.get("farm"),
        serviceId: selected.id,
        providerId: (fd.get("provider") as string) || undefined,
        scheduledFor: new Date(dateStr).toISOString(),
        areaBigha: area,
      });
      track("booking_created", { serviceCategory: selected.category });
      toast.success(t("bookingReceivedToast", lang));
      setSelected(null);
      await load();
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      setBusy(false);
    }
  }

  async function cancelBooking(b: Booking) {
    const ok = await confirm({
      title: t("cancelBooking", lang),
      body: `${b.service?.name ?? ""} · ${formatDateTime(b.scheduledFor, lang)} — ${t("cancelBookingBody", lang)}`,
      danger: true,
      confirmLabel: t("cancel", lang),
      cancelLabel: t("back", lang),
    });
    if (!ok) return;
    setCancellingId(b.id);
    try {
      await api("POST", `/bookings/${b.id}/status`, { status: "CANCELLED" });
      toast.success(t("bookingCancelledToast", lang));
      await load();
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="min-w-0 space-y-5">
      {/* Header — Gap Analysis §4.8 */}
      <div className="flex items-center gap-3 animate-enterprise">
        <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#F0FDF4] text-[#15803D] ring-1 ring-[#DCFCE7]" aria-hidden>
          <Tractor className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-[24px] font-bold leading-8 tracking-[-0.02em] text-[#1A1F1C]">{t("services", lang)}</h1>
          <p className="text-[13px] leading-4 text-[#78716C]">{services.length} {lang==="bn" ? "টি সেবা • আজই বুক করুন" : "services • Book today"}</p>
        </div>
      </div>

      {/* Trust strip — DeHaat pattern */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#E7E5E4] bg-white px-3 py-2 text-[12px] text-[#57534E] shadow-sm animate-enterprise" style={{ animationDelay: "60ms" } as React.CSSProperties}>
        <span className="flex -space-x-1.5" aria-hidden>
          <span className="h-6 w-6 rounded-full border-2 border-white bg-[#FEF9C3]" />
          <span className="h-6 w-6 rounded-full border-2 border-white bg-[#DCFCE7]" />
          <span className="h-6 w-6 rounded-full border-2 border-white bg-[#FDBA74]" />
        </span>
        <span className="font-medium">15k+ {lang==="bn" ? "কৃষক" : "farmers"}</span>
        <span aria-hidden>•</span>
        <span className="flex items-center gap-1">⭐ 4.8/5</span>
        <span aria-hidden>•</span>
        <span>{lang==="bn" ? "২৪/৭ সাপোর্ট" : "24/7 support"}</span>
      </div>

      {loadError && (
        <div className="space-y-2">
          <ErrorBanner message={loadError} />
          <Button variant="outline" onClick={() => void load()}>{t("retry", lang)}</Button>
        </div>
      )}

      {!loading && !loadError && farms.length === 0 && (
        <Card className="flex items-center gap-2 border-amber-200 bg-amber-50 text-sm font-medium text-amber-800">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden /> {t("needFarmFirst", lang)}
          <a href="/farm" className="ml-auto text-xs font-bold underline hover:no-underline">{t("myFarm", lang)} →</a>
        </Card>
      )}

      {/* Filter bar — Gap Analysis §4.8 */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#78716C]" aria-hidden />
          <input
            type="search"
            placeholder={lang==="bn" ? "সেবা খুঁজুন… (ড্রোন, ট্রাক্টর, মাটি)" : "Search services… (drone, tractor, soil)"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-[44px] w-full rounded-[12px] border border-[#E7E5E4] bg-white pl-10 pr-4 text-[14px] font-medium text-[#1A1F1C] placeholder:text-[#78716C] shadow-sm focus:border-[#15803D] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
            aria-label={lang==="bn" ? "সেবা খুঁজুন" : "Search services"}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F8FAF5] text-[#78716C]" aria-hidden><SlidersHorizontal className="h-4 w-4" /></span>
          {(Object.keys(CHIP_LABEL) as FilterKey[]).map((k) => (
            <button
              key={k}
              onClick={() => setActiveFilter(k)}
              className={`rounded-full border px-3.5 py-2 text-[13px] font-semibold transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D] ${activeFilter===k ? "border-[#15803D] bg-[#15803D] text-white shadow-sm" : "border-[#E7E5E4] bg-white text-[#1A1F1C] hover:border-[#15803D]/30 hover:bg-[#F8FAF5]"}`}
            >
              {CHIP_LABEL[k]}
            </button>
          ))}
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as never)}
            className="ml-auto rounded-full border border-[#E7E5E4] bg-white px-3 py-2 text-[13px] font-medium text-[#1A1F1C] focus:border-[#15803D] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
            aria-label={lang==="bn" ? "সাজান" : "Sort"}
          >
            <option value="default">{lang==="bn" ? "সাজান" : "Sort"}</option>
            <option value="priceAsc">{lang==="bn" ? "দাম: কম থেকে বেশি" : "Price: Low to High"}</option>
            <option value="priceDesc">{lang==="bn" ? "দাম: বেশি থেকে কম" : "Price: High to Low"}</option>
          </select>
        </div>
      </div>

      {/* Grid — Gap Analysis: 1-col mobile, 2-col tablet, 3-col desktop, gap 20px, stagger */}
      {loading && !loadError ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {[0,1,2,3,4,5].map((i) => <ServiceCardSkeleton key={i} />)}
        </div>
      ) : filtered.length===0 ? (
        <EmptyState
          title={lang==="bn" ? "কোন সেবা পাওয়া যায়নি" : "No services found"}
          description={lang==="bn" ? "অন্য ক্যাটাগরি বা সার্চ শব্দ চেষ্টা করুন।" : "Try another search or filter."}
        />
      ) : (
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s, idx) => {
            const badge = idx===0 ? "popular" as const : s.category==="AGRONOMIST" && idx===1 ? "new" as const : null;
            const verified = s.category==="AGRONOMIST";
            return (
              <motion.div key={s.id} variants={itemVariants}>
                <ServiceCard
                  title={s.name}
                  category={s.category}
                  pricePaisa={s.basePricePaisa}
                  priceUnit={s.priceUnit}
                  rating={4.9 - (idx%3)*0.1}
                  ratingCount={s.providers[0]?.ratingCount ?? 1200}
                  bookings={3400 - idx*320}
                  badge={badge}
                  verified={verified}
                  lang={lang}
                  onBook={() => { setFormErrs({}); setSelected(s); }}
                  onDetails={() => { setFormErrs({}); setSelected(s); }}
                />
              </motion.div>
            );
          })}
        </motion.div>
      )}

      {/* Booking BottomSheet — Gap Analysis §4.7 AnimatePresence spring */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center"
            onMouseDown={(e) => { if (e.target===e.currentTarget) setSelected(null); }}
          >
            <motion.div
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ type: "spring", stiffness: 340, damping: 28 }}
              className="max-h-[85vh] w-full max-w-lg overflow-hidden rounded-[20px] border border-[#15803D]/20 bg-white shadow-xl"
            >
              <div className="relative h-28 w-full overflow-hidden">
                <img src={`https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=80`} alt="" className="h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-black/10" />
                <button onClick={()=>setSelected(null)} className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-[#1A1F1C] shadow hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" aria-label={t("close", lang)}><X className="h-4 w-4" /></button>
                <div className="absolute bottom-3 left-4 right-4">
                  <h3 className="text-[18px] font-bold leading-tight text-white">{selected.name}</h3>
                  <p className="text-[12px] font-medium text-white/80">{formatBDT(selected.basePricePaisa, lang)} • {selected.category}</p>
                </div>
              </div>
              <form onSubmit={book} noValidate className="grid gap-4 p-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="bk-farm">{t("farmLabel", lang)}</Label>
                  <Select id="bk-farm" name="farm" defaultValue="" onChange={()=>setFormErrs(p=>{ const n={...p}; delete n.farm; return n; })} aria-invalid={Boolean(formErrs.farm)} aria-describedby={formErrs.farm ? "bk-farm-err":undefined}>
                    <option value="" disabled>{t("farmLabel", lang)}</option>
                    {farms.map(f=> <option key={f.id} value={f.id}>{f.name}</option>)}
                  </Select>
                  {formErrs.farm && <p id="bk-farm-err" role="alert" className="mt-1 text-xs font-medium text-red-600">{formErrs.farm}</p>}
                </div>
                <div>
                  <Label htmlFor="bk-date">{t("scheduleLabel", lang)}</Label>
                  <Input id="bk-date" name="date" type="datetime-local" min={new Date().toISOString().slice(0,16)} onChange={()=>setFormErrs(p=>{ const n={...p}; delete n.date; return n; })} aria-invalid={Boolean(formErrs.date)} />
                  {formErrs.date && <p role="alert" className="mt-1 text-xs font-medium text-red-600">{formErrs.date}</p>}
                </div>
                <div>
                  <Label htmlFor="bk-area">{t("areaBigha", lang)}</Label>
                  <Input id="bk-area" name="area" type="number" step="0.1" min="0.1" onChange={()=>setFormErrs(p=>{ const n={...p}; delete n.area; return n; })} aria-invalid={Boolean(formErrs.area)} />
                  {formErrs.area && <p role="alert" className="mt-1 text-xs font-medium text-red-600">{formErrs.area}</p>}
                </div>
                <div>
                  <Label htmlFor="bk-provider">{t("providerLabel", lang)}</Label>
                  <Select id="bk-provider" name="provider" defaultValue="">
                    <option value="">{t("providerDefaultOption", lang)}</option>
                    {selected.providers.map(p=> <option key={p.id} value={p.id}>{p.name}{p.district ? ` · ${p.district}`:""}</option>)}
                  </Select>
                </div>
                <div className="flex gap-2 sm:col-span-2">
                  <Button type="button" variant="outline" className="flex-1 py-3" onClick={()=>setSelected(null)}>{t("cancel", lang)}</Button>
                  <Button type="submit" className="flex-[3] justify-center gap-1.5 rounded-[12px] bg-[#15803D] py-3 text-[15px] font-bold shadow-button" loading={busy}>{t("submit", lang)} <span aria-hidden>→</span></Button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* My bookings — refined Gap Analysis trust */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 px-1 text-[16px] font-bold text-[#1A1F1C]"><ClipboardList className="h-5 w-5 text-[#15803D]" aria-hidden /> {t("myBookings", lang)} <Badge className="bg-[#E8EEE9] text-[#15803D]">{bookings.length}</Badge></h2>
        {loading && !loadError ? <Card><Skeleton className="h-16 w-full" /></Card> : bookings.length===0 ? <EmptyState icon={<ClipboardList className="h-10 w-10 text-stone-300" aria-hidden />} title={t("noBookings", lang)} description={lang==="bn" ? "উপরে যেকোনো সেবা থেকে বুক করুন — ফিল্ডে কাজ দ্রুত শুরু হবে।" : "Book any service above — field work starts fast."} /> : (
          <div className="space-y-3">
            {bookings.map((b)=> (
              <Card key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border-[#E7E5E4]">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-[#1A1F1C]">{b.service?.name ?? b.bookingNo}<Badge className={`${b.status==="CANCELLED" ? "bg-red-100 text-red-700" : b.status==="COMPLETED" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"} border`}>{bookingStatusLabel(b.status, lang)}</Badge></p>
                  <p className="mt-1 text-xs text-[#78716C]">{formatDateTime(b.scheduledFor, lang)} · {b.farm?.name} · {t("estimatedPrice", lang)}: <span className="font-semibold text-[#0F7B3F]">{formatBDT(b.estimatedPricePaisa, lang)}</span></p>
                </div>
                {(b.status==="REQUESTED"||b.status==="ASSIGNED") && <Button variant="danger" size="sm" loading={cancellingId===b.id} onClick={()=>void cancelBooking(b)} className="min-h-[40px]">{t("cancelBooking", lang)}</Button>}
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
