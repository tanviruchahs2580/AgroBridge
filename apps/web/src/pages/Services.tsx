import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";
import { formatBDT, formatDateTime } from "../lib/format.js";
import { bookingStatusLabel } from "../lib/labels.js";
import { mapError } from "../lib/errors-ui.js";
import { track } from "../lib/analytics.js";
import { ClipboardList, Search, SlidersHorizontal, Tractor, TriangleAlert, X, CheckCircle2, CalendarClock, ArrowRight, ShieldCheck, Leaf, Wrench, Phone } from "lucide-react";
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
  providers: { id: string; name: string; district?: string; ratingCount: number; ratingSum: number }[];
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
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.08 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] as const } },
};

export default function Services() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const toast = useToast();
  const confirm = useConfirm();
  const searchRef = useRef<HTMLInputElement>(null);

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
  const sheetRef = useRef<HTMLDivElement | null>(null);

  // Booking sheet dialog semantics: move focus in, close on Escape, restore focus out.
  useEffect(() => {
    if (!selected) return;
    const prev = document.activeElement as HTMLElement | null;
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [selected]);

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

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    let out = services.filter((s) => {
      const cats = FILTER_MAP[activeFilter];
      const matchesFilter = activeFilter === "ALL" || cats.includes(s.category);
      const q = query.trim().toLowerCase();
      const matchesQ = !q || s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q);
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
    <div className="min-w-0 space-y-8">
      {/* SECTION 01 — HERO — concise, Bangla-first, field-rooted */}
      <section className="overflow-hidden rounded-[20px] border border-[#E7E5E4] bg-white shadow-card">
        <div className="grid gap-6 p-6 sm:grid-cols-[1.2fr_0.8fr] sm:p-8">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#DCFCE7] bg-[#F0FDF4] px-3 py-1 text-[12px] font-semibold text-[#14532D]">
              <Leaf className="h-3.5 w-3.5" aria-hidden /> {lang === "bn" ? "মাঠের সেবা • যাচাইকৃত" : "Field services • Verified"}
            </div>
            <h1 className="mt-3 text-balance text-[26px] font-bold leading-8 tracking-[-0.02em] text-[#1A1F1C] sm:text-[28px]">
              {lang === "bn" ? "আপনার জমির জন্য সঠিক সেবা, এক ক্লিকে" : "The right service for your field, in one tap"}
            </h1>
            <p className="mt-2 max-w-[52ch] text-[14px] leading-6 text-[#57534E]">
              {lang === "bn"
                ? "যন্ত্রপাতি, স্মার্ট ফার্মিং ও মাটি পরীক্ষা — স্বচ্ছ মূল্য, স্থানীয় প্রদানকারী, দ্রুত বুকিং।"
                : "Machinery, smart farming and soil testing — transparent pricing, local providers, fast booking."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => searchRef.current?.focus()} className="min-h-[44px] rounded-[12px] bg-[#15803D] px-5 text-[14px] font-bold shadow-button hover:bg-[#14532D]">
                {lang === "bn" ? "সেবা খুঁজুন" : "Find a service"} <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
              </Button>
              <span className="inline-flex items-center rounded-full bg-[#F8FAF5] px-3 py-1 text-[12px] font-medium text-[#57534E]">
                {services.length} {lang === "bn" ? "টি সেবা" : "services"}
              </span>
            </div>
          </div>
          <div className="hidden sm:flex items-center justify-center rounded-[16px] bg-[#F8FAF5] p-4">
            <div className="grid w-full max-w-[280px] gap-3">
              <div className="flex items-center gap-3 rounded-[12px] border border-[#E7E5E4] bg-white px-3 py-3 shadow-sm">
                <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#FFF7ED] text-[#EA580C] ring-1 ring-[#FDBA74]"><Tractor className="h-5 w-5" /></span>
                <div className="min-w-0"><p className="text-[13px] font-semibold text-[#1A1F1C]">{lang==="bn"?"যন্ত্রপাতি":"Machinery"}</p><p className="text-[12px] text-[#78716C]">5 {lang==="bn"?"প্রকার":"types"}</p></div>
                <ArrowRight className="ml-auto h-4 w-4 text-[#78716C]" aria-hidden />
              </div>
              <div className="flex items-center gap-3 rounded-[12px] border border-[#E7E5E4] bg-white px-3 py-3 shadow-sm">
                <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#F0F9FF] text-[#0284C7] ring-1 ring-[#BAE6FD]"><Wrench className="h-5 w-5" /></span>
                <div className="min-w-0"><p className="text-[13px] font-semibold text-[#1A1F1C]">{lang==="bn"?"পরামর্শ":"Advisory"}</p><p className="text-[12px] text-[#78716C]">2 {lang==="bn"?"প্রকার":"types"}</p></div>
                <CheckCircle2 className="ml-auto h-4 w-4 text-[#15803D]" aria-hidden />
              </div>
              <div className="flex items-center gap-3 rounded-[12px] border border-[#E7E5E4] bg-white px-3 py-3 shadow-sm">
                <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#FDF6EE] text-[#92400E] ring-1 ring-[#FDE68A]"><ShieldCheck className="h-5 w-5" /></span>
                <div className="min-w-0"><p className="text-[13px] font-semibold text-[#1A1F1C]">{lang==="bn"?"পরীক্ষা":"Testing"}</p><p className="text-[12px] text-[#78716C]">1 {lang==="bn"?"প্রকার":"type"}</p></div>
                <span className="ml-auto text-[11px] font-bold text-[#15803D]">{lang==="bn"?"স্বচ্ছ":"Clear"}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {loadError && (
        <div className="space-y-2">
          <ErrorBanner message={loadError} />
          <Button variant="outline" onClick={() => void load()}>{t("retry", lang)}</Button>
        </div>
      )}

      {!loading && !loadError && farms.length === 0 && (
        <Card className="flex items-center gap-2 border-amber-200 bg-amber-50 text-sm font-medium text-amber-800">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden /> {t("needFarmFirst", lang)}
          <a href="/farm" className="ml-auto inline-flex min-h-[44px] items-center text-xs font-bold underline hover:no-underline"> {t("myFarm", lang)} →</a>
        </Card>
      )}

      {/* SECTION 02 — SERVICE DISCOVERY */}
      <section aria-labelledby="discover-title" className="space-y-3">
        <h2 id="discover-title" className="sr-only">{lang==="bn" ? "সেবা খুঁজুন" : "Discover services"}</h2>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#78716C]" aria-hidden />
          <input
            ref={searchRef}
            type="search"
            placeholder={lang === "bn" ? "সেবা খুঁজুন… (ড্রোন, ট্রাক্টর, মাটি)" : "Search services… (drone, tractor, soil)"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-[44px] w-full rounded-[12px] border border-[#E7E5E4] bg-white pl-10 pr-4 text-[14px] font-medium text-[#1A1F1C] placeholder:text-[#78716C] shadow-sm focus:border-[#15803D] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
            aria-label={lang === "bn" ? "সেবা খুঁজুন" : "Search services"}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#F8FAF5] text-[#78716C]" aria-hidden>
            <SlidersHorizontal className="h-4 w-4" />
          </span>
          {(Object.keys(CHIP_LABEL) as FilterKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setActiveFilter(k)}
              aria-pressed={activeFilter === k}
              className={`inline-flex min-h-[44px] items-center rounded-full border px-3.5 py-2 text-[13px] font-semibold transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D] ${activeFilter === k ? "border-[#15803D] bg-[#15803D] text-white shadow-sm" : "border-[#E7E5E4] bg-white text-[#1A1F1C] hover:border-[#15803D]/30 hover:bg-[#F8FAF5]"}`}
            >
              {CHIP_LABEL[k]}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2">
            <span className="sr-only">{lang === "bn" ? "সাজান" : "Sort"}</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as never)}
              className="min-h-[44px] rounded-full border border-[#E7E5E4] bg-white px-3 py-2 text-[13px] font-medium text-[#1A1F1C] focus:border-[#15803D] focus:outline-none focus:ring-2 focus:ring-[#15803D]/20"
              aria-label={lang === "bn" ? "সাজান" : "Sort"}
            >
              <option value="default">{lang === "bn" ? "সাজান" : "Sort"}</option>
              <option value="priceAsc">{lang === "bn" ? "দাম: কম থেকে বেশি" : "Price: Low to High"}</option>
              <option value="priceDesc">{lang === "bn" ? "দাম: বেশি থেকে কম" : "Price: High to Low"}</option>
            </select>
          </label>
        </div>
        <p className="px-1 text-[12px] font-medium text-[#78716C]" aria-live="polite">
          {filtered.length} {lang === "bn" ? "টি সেবা" : "services"} {query || activeFilter !== "ALL" ? (lang === "bn" ? "পাওয়া গেছে" : "found") : ""}
        </p>
      </section>

      {/* SECTION 05 — ALL SERVICES — 1col mobile, 2-col tablet, 3-col desktop, 20px gap */}
      {loading && !loadError ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <ServiceCardSkeleton key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          title={lang === "bn" ? "কোন সেবা পাওয়া যায়নি" : "No services found"}
          description={lang === "bn" ? "অন্য ক্যাটাগরি বা সার্চ শব্দ চেষ্টা করুন।" : "Try another search or filter."}
        />
      ) : (
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s, i) => (
            <motion.div key={s.id} variants={itemVariants} className="motion-reduce:transform-none">
              <ServiceCard
                index={i}
                title={s.name}
                category={s.category}
                pricePaisa={s.basePricePaisa}
                priceUnit={s.priceUnit}
                description={s.description}
                providers={s.providers}
                lang={lang}
                onBook={() => {
                  setFormErrs({});
                  setSelected(s);
                }}
                onDetails={() => {
                  setFormErrs({});
                  setSelected(s);
                }}
              />
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* SECTION 06 — HOW IT WORKS — real flow only */}
      <section aria-labelledby="how-title" className="rounded-[20px] border border-[#E7E5E4] bg-white p-6 shadow-sm sm:p-8">
        <h2 id="how-title" className="text-[18px] font-bold tracking-[-0.01em] text-[#1A1F1C]">
          {lang === "bn" ? "কিভাবে কাজ করে" : "How it works"}
        </h2>
        <p className="mt-1 text-[13px] leading-5 text-[#57534E]">{lang === "bn" ? "৩টি সহজ ধাপে বুকিং সম্পন্ন করুন।" : "Book in 3 simple steps."}</p>
        <ol className="mt-6 grid gap-6 sm:grid-cols-3">
          <li className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F0FDF4] text-[#15803D] ring-1 ring-[#DCFCE7]" aria-hidden>
              <Search className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-[#1A1F1C]">{lang === "bn" ? "১. সেবা নির্বাচন" : "1. Choose a service"}</p>
              <p className="mt-1 text-[13px] leading-5 text-[#57534E]">{lang === "bn" ? "প্রয়োজন অনুযায়ী সেবা খুঁজুন ও নির্বাচন করুন।" : "Find and select the service you need."}</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F0FDF4] text-[#15803D] ring-1 ring-[#DCFCE7]" aria-hidden>
              <CalendarClock className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-[#1A1F1C]">{lang === "bn" ? "২. জমি ও সময়" : "2. Field & schedule"}</p>
              <p className="mt-1 text-[13px] leading-5 text-[#57534E]">{lang === "bn" ? "আপনার ফার্ম, তারিখ ও জমির পরিমাণ দিন।" : "Pick your farm, date and area."}</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#F0FDF4] text-[#15803D] ring-1 ring-[#DCFCE7]" aria-hidden>
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-[#1A1F1C]">{lang === "bn" ? "৩. নিশ্চিত করুন" : "3. Confirm"}</p>
              <p className="mt-1 text-[13px] leading-5 text-[#57534E]">{lang === "bn" ? "বুক করুন — প্রদানকারী নির্ধারিত হবে।" : "Book — a provider will be assigned."}</p>
            </div>
          </li>
        </ol>
      </section>

      {/* SECTION 07 — TRUST — real claims only */}
      <section aria-labelledby="trust-title" className="rounded-[20px] border border-[#E7E5E4] bg-[#F8FAF5] p-6 sm:p-8">
        <h2 id="trust-title" className="text-[18px] font-bold tracking-[-0.01em] text-[#1A1F1C]">
          {lang === "bn" ? "কেন এগ্রোব্রিজ" : "Why AgroBridge"}
        </h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-3">
          <li className="flex gap-3 rounded-[16px] border border-[#E7E5E4] bg-white p-4 shadow-sm">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#15803D]" aria-hidden />
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-[#1A1F1C]">{lang === "bn" ? "যাচাইকৃত সেবা" : "Verified services"}</p>
              <p className="mt-1 text-[13px] leading-5 text-[#57534E]">{lang === "bn" ? "সক্রিয় সেবা ও প্রদানকারী তালিকা।" : "Active services and providers."}</p>
            </div>
          </li>
          <li className="flex gap-3 rounded-[16px] border border-[#E7E5E4] bg-white p-4 shadow-sm">
            <Leaf className="mt-0.5 h-5 w-5 shrink-0 text-[#15803D]" aria-hidden />
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-[#1A1F1C]">{lang === "bn" ? "স্বচ্ছ মূল্য" : "Transparent pricing"}</p>
              <p className="mt-1 text-[13px] leading-5 text-[#57534E]">{lang === "bn" ? "প্রতি বিঘা/ঘণ্টা/দিন হিসাব।" : "Per bigha/hour/day."}</p>
            </div>
          </li>
          <li className="flex gap-3 rounded-[16px] border border-[#E7E5E4] bg-white p-4 shadow-sm">
            <Phone className="mt-0.5 h-5 w-5 shrink-0 text-[#15803D]" aria-hidden />
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-[#1A1F1C]">{lang === "bn" ? "সহায়তা" : "Support"}</p>
              <p className="mt-1 text-[13px] leading-5 text-[#57534E]">{lang === "bn" ? "প্রয়োজনে যোগাযোগ করুন।" : "Get help when you need it."}</p>
            </div>
          </li>
        </ul>
      </section>

      {/* SECTION 08 — FINAL CTA — existing working action */}
      <section className="flex flex-col items-start gap-3 rounded-[20px] border border-[#15803D]/15 bg-[#F0FDF4] p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div className="min-w-0">
          <h2 className="text-[18px] font-bold tracking-[-0.01em] text-[#14532D]">{lang === "bn" ? "সহায়তা প্রয়োজন?" : "Need help?"}</h2>
          <p className="mt-1 text-[13px] leading-5 text-[#14532D]/80">{lang === "bn" ? "আপনার ফার্ম যোগ করুন — সেবা বুকিং দ্রুত হবে।" : "Add your farm — booking will be faster."}</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <a href="/farm" className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[12px] border border-[#15803D]/20 bg-white px-4 py-2.5 text-[13px] font-semibold text-[#14532D] transition hover:bg-[#F8FAF5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D] sm:flex-none">
            {t("myFarm", lang)}
          </a>
          <Button onClick={() => searchRef.current?.focus()} className="min-h-[44px] flex-1 justify-center gap-1.5 rounded-[12px] bg-[#15803D] text-white shadow-button hover:bg-[#14532D] sm:flex-none">
            {lang === "bn" ? "সেবা খুঁজুন" : "Find services"} <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </section>

      {/* Booking BottomSheet — real API, paisa intact, a11y */}
      <AnimatePresence>
        {selected && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-sm sm:items-center"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setSelected(null);
            }}
          >
            <motion.div
              ref={sheetRef}
              role="dialog"
              aria-modal="true"
              aria-label={selected.name}
              tabIndex={-1}
              initial={{ y: 24, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 24, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="max-h-[85vh] w-full max-w-lg overflow-hidden rounded-[20px] border border-[#E7E5E4] bg-white shadow-xl focus-visible:outline-none"
            >
              <div className="relative h-28 w-full overflow-hidden">
                <img
                  src={(() => {
                    const map: Record<string, string> = {
                      THRESHER: "/images/services/thresher.jpg",
                      SOIL_TESTING: "/images/services/soil-test.jpg",
                      POWER_TILLER: "/images/services/power-tiller.jpg",
                      LAND_LEVELLER: "/images/services/land-leveller.png",
                      DRONE: "/images/services/drone.jpg",
                      COMBINE_HARVESTER: "/images/services/combine.jpg",
                      AGRONOMIST: "/images/services/agronomist.jpg",
                      TRACTOR: "/images/services/tractor.jpg",
                    };
                    return map[selected.category] ?? "/images/services/tractor.jpg";
                  })()}
                  alt={selected.name}
                  className="h-full w-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-black/10" />
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-[#1A1F1C] shadow hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  aria-label={t("close", lang)}
                >
                  <X className="h-4 w-4" />
                </button>
                <div className="absolute bottom-3 left-4 right-4">
                  <h3 className="text-[18px] font-bold leading-tight text-white">{selected.name}</h3>
                  <p className="text-[12px] font-medium text-white/80">
                    {formatBDT(selected.basePricePaisa, lang)} • {selected.category}
                  </p>
                </div>
              </div>
              <form onSubmit={book} noValidate className="grid gap-4 p-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="bk-farm">{t("farmLabel", lang)}</Label>
                  <Select
                    id="bk-farm"
                    name="farm"
                    defaultValue=""
                    onChange={() => setFormErrs((p) => { const n = { ...p }; delete n.farm; return n; })}
                    aria-invalid={Boolean(formErrs.farm)}
                    aria-describedby={formErrs.farm ? "bk-farm-err" : undefined}
                  >
                    <option value="" disabled>
                      {t("farmLabel", lang)}
                    </option>
                    {farms.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </Select>
                  {formErrs.farm && <p id="bk-farm-err" role="alert" className="mt-1 text-xs font-medium text-red-600">{formErrs.farm}</p>}
                </div>
                <div>
                  <Label htmlFor="bk-date">{t("scheduleLabel", lang)}</Label>
                  <Input
                    id="bk-date"
                    name="date"
                    type="datetime-local"
                    min={new Date().toISOString().slice(0, 16)}
                    onChange={() => setFormErrs((p) => { const n = { ...p }; delete n.date; return n; })}
                    aria-invalid={Boolean(formErrs.date)}
                  />
                  {formErrs.date && <p role="alert" className="mt-1 text-xs font-medium text-red-600">{formErrs.date}</p>}
                </div>
                <div>
                  <Label htmlFor="bk-area">{t("areaBigha", lang)}</Label>
                  <Input
                    id="bk-area"
                    name="area"
                    type="number"
                    step="0.1"
                    min="0.1"
                    onChange={() => setFormErrs((p) => { const n = { ...p }; delete n.area; return n; })}
                    aria-invalid={Boolean(formErrs.area)}
                  />
                  {formErrs.area && <p role="alert" className="mt-1 text-xs font-medium text-red-600">{formErrs.area}</p>}
                </div>
                <div>
                  <Label htmlFor="bk-provider">{t("providerLabel", lang)}</Label>
                  <Select id="bk-provider" name="provider" defaultValue="">
                    <option value="">{t("providerDefaultOption", lang)}</option>
                    {selected.providers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.district ? ` · ${p.district}` : ""}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex gap-2 sm:col-span-2">
                  <Button type="button" variant="outline" className="min-h-[44px] flex-1 justify-center py-3" onClick={() => setSelected(null)}>
                    {t("cancel", lang)}
                  </Button>
                  <Button type="submit" className="min-h-[44px] flex-[3] justify-center gap-1.5 rounded-[12px] bg-[#15803D] py-3 text-[15px] font-bold shadow-button" loading={busy}>
                    {t("submit", lang)} <span aria-hidden>→</span>
                  </Button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* My bookings — real data, no fabricated timeline */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 px-1 text-[16px] font-bold text-[#1A1F1C]">
          <ClipboardList className="h-5 w-5 text-[#15803D]" aria-hidden /> {t("myBookings", lang)}{" "}
          <Badge className="bg-[#E8EEE9] text-[#15803D]">{bookings.length}</Badge>
        </h2>
        {loading && !loadError ? (
          <Card>
            <Skeleton className="h-16 w-full" />
          </Card>
        ) : bookings.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-10 w-10 text-stone-300" aria-hidden />}
            title={t("noBookings", lang)}
            description={lang === "bn" ? "উপরে যেকোনো সেবা থেকে বুক করুন — ফিল্ডে কাজ দ্রুত শুরু হবে।" : "Book any service above — field work starts fast."}
          />
        ) : (
          <div className="space-y-3">
            {bookings.map((b) => (
              <Card key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[20px] border-[#E7E5E4]">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-[#1A1F1C]">
                    {b.service?.name ?? b.bookingNo}
                    <Badge className={`${b.status === "CANCELLED" ? "bg-red-100 text-red-700" : b.status === "COMPLETED" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"} border`}>
                      {bookingStatusLabel(b.status, lang)}
                    </Badge>
                  </p>
                  <p className="mt-1 text-xs text-[#78716C]">
                    {formatDateTime(b.scheduledFor, lang)} · {b.farm?.name} · {t("estimatedPrice", lang)}: <span className="font-semibold text-[#0F7B3F]">{formatBDT(b.estimatedPricePaisa, lang)}</span>
                  </p>
                </div>
                {(b.status === "REQUESTED" || b.status === "ASSIGNED") && (
                  <Button variant="danger" size="sm" loading={cancellingId === b.id} onClick={() => void cancelBooking(b)} className="min-h-[44px]">
                    {t("cancelBooking", lang)}
                  </Button>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
