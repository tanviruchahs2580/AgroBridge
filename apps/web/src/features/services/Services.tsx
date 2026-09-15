import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { t } from "../../lib/i18n";
import { formatBDT, formatDateTime } from "../../lib/format";
import { bookingStatusLabel } from "../../lib/labels";
import { mapError } from "../../lib/errors-ui";
import { track } from "../../lib/analytics";
import { ClipboardList, Search, SlidersHorizontal, Tractor, TriangleAlert, X, CheckCircle2, CalendarClock, ArrowRight, ShieldCheck, Leaf, Wrench, Phone } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, Label, Select, Skeleton, useConfirm, useToast } from "../../components/ui";
import { ServiceCard, ServiceCardSkeleton } from "../../components/service/ServiceCard";

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
/** Filter chips are bilingual via the dictionary (v2) — never hardcoded. */
const CHIP_KEY: Record<FilterKey, "svcFilterAll" | "svcFilterMech" | "svcFilterAdvisory" | "svcFilterTest"> = {
  ALL: "svcFilterAll",
  MECH: "svcFilterMech",
  ADVISORY: "svcFilterAdvisory",
  TEST: "svcFilterTest",
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

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      <section className="overflow-hidden rounded-card border border-surface-border bg-white shadow-card">
        <div className="grid gap-6 p-6 sm:grid-cols-[1.2fr_0.8fr] sm:p-8">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-[12px] font-semibold text-accent">
              <Leaf className="h-3.5 w-3.5" aria-hidden /> {lang === "bn" ? "মাঠের সেবা • যাচাইকৃত" : "Field services • Verified"}
            </div>
            <h1 className="mt-3 text-balance text-[26px] font-bold leading-8 tracking-[-0.02em] text-stone-800 sm:text-[28px]">
              {lang === "bn" ? "আপনার জমির জন্য সঠিক সেবা, এক ক্লিকে" : "The right service for your field, in one tap"}
            </h1>
            <p className="mt-2 max-w-[52ch] text-[14px] leading-6 text-stone-600">
              {lang === "bn"
                ? "যন্ত্রপাতি, স্মার্ট ফার্মিং ও মাটি পরীক্ষা — স্বচ্ছ মূল্য, স্থানীয় প্রদানকারী, দ্রুত বুকিং।"
                : "Machinery, smart farming and soil testing — transparent pricing, local providers, fast booking."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => searchRef.current?.focus()} className="min-h-[44px] rounded-button bg-action px-5 text-[14px] font-bold shadow-button hover:bg-action-hover">
                {lang === "bn" ? "সেবা খুঁজুন" : "Find a service"} <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
              </Button>
              <span className="inline-flex items-center rounded-full bg-surface-subdued px-3 py-1 text-[12px] font-medium text-stone-600">
                {services.length} {lang === "bn" ? "টি সেবা" : "services"}
              </span>
            </div>
          </div>
          <div className="hidden sm:flex items-center justify-center rounded-2xl bg-surface-subdued p-4">
            <div className="grid w-full max-w-[280px] gap-3">
              <div className="flex items-center gap-3 rounded-button border border-surface-border bg-white px-3 py-3 shadow-sm">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-50 text-orange-600 ring-1 ring-warning-border"><Tractor className="h-5 w-5" /></span>
                <div className="min-w-0"><p className="text-[13px] font-semibold text-stone-800">{lang==="bn"?"যন্ত্রপাতি":"Machinery"}</p><p className="text-[12px] text-stone-500">5 {lang==="bn"?"প্রকার":"types"}</p></div>
                <ArrowRight className="ml-auto h-4 w-4 text-stone-500" aria-hidden />
              </div>
              <div className="flex items-center gap-3 rounded-button border border-surface-border bg-white px-3 py-3 shadow-sm">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50 text-sky-600 ring-1 ring-sky-200"><Wrench className="h-5 w-5" /></span>
                <div className="min-w-0"><p className="text-[13px] font-semibold text-stone-800">{lang==="bn"?"পরামর্শ":"Advisory"}</p><p className="text-[12px] text-stone-500">2 {lang==="bn"?"প্রকার":"types"}</p></div>
                <CheckCircle2 className="ml-auto h-4 w-4 text-link" aria-hidden />
              </div>
              <div className="flex items-center gap-3 rounded-button border border-surface-border bg-white px-3 py-3 shadow-sm">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-enterprise-soil-50 text-warning-text ring-1 ring-warning-border"><ShieldCheck className="h-5 w-5" /></span>
                <div className="min-w-0"><p className="text-[13px] font-semibold text-stone-800">{lang==="bn"?"পরীক্ষা":"Testing"}</p><p className="text-[12px] text-stone-500">1 {lang==="bn"?"প্রকার":"type"}</p></div>
                <span className="ml-auto text-[11px] font-bold text-link">{lang==="bn"?"স্বচ্ছ":"Clear"}</span>
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
        <Card className="flex items-center gap-2 border-warning-border bg-warning-bg text-sm font-medium text-warning-text">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden /> {t("needFarmFirst", lang)}
          <a href="/farm" className="ml-auto inline-flex min-h-[44px] items-center text-xs font-bold underline hover:no-underline"> {t("myFarm", lang)} →</a>
        </Card>
      )}

      {/* SECTION 02 — SERVICE DISCOVERY */}
      <section aria-labelledby="discover-title" className="space-y-3">
        <h2 id="discover-title" className="sr-only">{lang==="bn" ? "সেবা খুঁজুন" : "Discover services"}</h2>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" aria-hidden />
          <input
            ref={searchRef}
            type="search"
            placeholder={t("svcSearchPh", lang)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-[44px] w-full rounded-button border border-surface-border bg-white pl-10 pr-4 text-[14px] font-medium text-stone-800 placeholder:text-stone-500 shadow-sm focus:border-action focus:outline-none focus:ring-2 focus:ring-brand-200"
            aria-label={t("svcSearchLabel", lang)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-subdued text-stone-500" aria-hidden>
            <SlidersHorizontal className="h-4 w-4" />
          </span>
          {(Object.keys(CHIP_KEY) as FilterKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setActiveFilter(k)}
              aria-pressed={activeFilter === k}
              className={`inline-flex min-h-[44px] items-center rounded-full border px-3.5 py-2 text-[13px] font-semibold transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] ${activeFilter === k ? "border-action bg-action text-white shadow-sm" : "border-surface-border bg-white text-stone-800 hover:border-brand-300 hover:bg-surface-subdued"}`}
            >
              {t(CHIP_KEY[k], lang)}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2">
            <span className="sr-only">{t("svcSortLabel", lang)}</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as never)}
              className="min-h-[44px] rounded-full border border-surface-border bg-white px-3 py-2 text-[13px] font-medium text-stone-800 focus:border-action focus:outline-none focus:ring-2 focus:ring-brand-200"
              aria-label={t("svcSortLabel", lang)}
            >
              <option value="default">{t("svcSortLabel", lang)}</option>
              <option value="priceAsc">{t("svcSortAsc", lang)}</option>
              <option value="priceDesc">{t("svcSortDesc", lang)}</option>
            </select>
          </label>
        </div>
        <p className="px-1 text-[12px] font-medium text-stone-500" aria-live="polite">
          {t("svcCount", lang, { n: filtered.length })}{query || activeFilter !== "ALL" ? ` ${t("svcFoundWord", lang)}` : ""}
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
          title={t("svcEmptyTitle", lang)}
          description={t("svcEmptyHint", lang)}
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
      <section aria-labelledby="how-title" className="rounded-card border border-surface-border bg-white p-6 shadow-sm sm:p-8">
        <h2 id="how-title" className="text-[18px] font-bold tracking-[-0.01em] text-stone-800">
          {lang === "bn" ? "কিভাবে কাজ করে" : "How it works"}
        </h2>
        <p className="mt-1 text-[13px] leading-5 text-stone-600">{lang === "bn" ? "৩টি সহজ ধাপে বুকিং সম্পন্ন করুন।" : "Book in 3 simple steps."}</p>
        <ol className="mt-6 grid gap-6 sm:grid-cols-3">
          <li className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-link ring-1 ring-brand-100" aria-hidden>
              <Search className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-stone-800">{lang === "bn" ? "১. সেবা নির্বাচন" : "1. Choose a service"}</p>
              <p className="mt-1 text-[13px] leading-5 text-stone-600">{lang === "bn" ? "প্রয়োজন অনুযায়ী সেবা খুঁজুন ও নির্বাচন করুন।" : "Find and select the service you need."}</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-link ring-1 ring-brand-100" aria-hidden>
              <CalendarClock className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-stone-800">{lang === "bn" ? "২. জমি ও সময়" : "2. Field & schedule"}</p>
              <p className="mt-1 text-[13px] leading-5 text-stone-600">{lang === "bn" ? "আপনার ফার্ম, তারিখ ও জমির পরিমাণ দিন।" : "Pick your farm, date and area."}</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-link ring-1 ring-brand-100" aria-hidden>
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-stone-800">{lang === "bn" ? "৩. নিশ্চিত করুন" : "3. Confirm"}</p>
              <p className="mt-1 text-[13px] leading-5 text-stone-600">{lang === "bn" ? "বুক করুন — প্রদানকারী নির্ধারিত হবে।" : "Book — a provider will be assigned."}</p>
            </div>
          </li>
        </ol>
      </section>

      {/* SECTION 07 — TRUST — real claims only */}
      <section aria-labelledby="trust-title" className="rounded-card border border-surface-border bg-surface-subdued p-6 sm:p-8">
        <h2 id="trust-title" className="text-[18px] font-bold tracking-[-0.01em] text-stone-800">
          {lang === "bn" ? "কেন এগ্রোব্রিজ" : "Why AgroBridge"}
        </h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-3">
          <li className="flex gap-3 rounded-2xl border border-surface-border bg-white p-4 shadow-sm">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-link" aria-hidden />
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-stone-800">{lang === "bn" ? "যাচাইকৃত সেবা" : "Verified services"}</p>
              <p className="mt-1 text-[13px] leading-5 text-stone-600">{lang === "bn" ? "সক্রিয় সেবা ও প্রদানকারী তালিকা।" : "Active services and providers."}</p>
            </div>
          </li>
          <li className="flex gap-3 rounded-2xl border border-surface-border bg-white p-4 shadow-sm">
            <Leaf className="mt-0.5 h-5 w-5 shrink-0 text-link" aria-hidden />
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-stone-800">{lang === "bn" ? "স্বচ্ছ মূল্য" : "Transparent pricing"}</p>
              <p className="mt-1 text-[13px] leading-5 text-stone-600">{lang === "bn" ? "প্রতি বিঘা/ঘণ্টা/দিন হিসাব।" : "Per bigha/hour/day."}</p>
            </div>
          </li>
          <li className="flex gap-3 rounded-2xl border border-surface-border bg-white p-4 shadow-sm">
            <Phone className="mt-0.5 h-5 w-5 shrink-0 text-link" aria-hidden />
            <div className="min-w-0">
              <p className="text-[14px] font-semibold text-stone-800">{lang === "bn" ? "সহায়তা" : "Support"}</p>
              <p className="mt-1 text-[13px] leading-5 text-stone-600">{lang === "bn" ? "প্রয়োজনে যোগাযোগ করুন।" : "Get help when you need it."}</p>
            </div>
          </li>
        </ul>
      </section>

      {/* SECTION 08 — FINAL CTA — existing working action */}
      <section className="flex flex-col items-start gap-3 rounded-card border border-brand-200 bg-brand-50 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div className="min-w-0">
          <h2 className="text-[18px] font-bold tracking-[-0.01em] text-accent">{lang === "bn" ? "সহায়তা প্রয়োজন?" : "Need help?"}</h2>
          <p className="mt-1 text-[13px] leading-5 text-stone-600">{lang === "bn" ? "আপনার ফার্ম যোগ করুন — সেবা বুকিং দ্রুত হবে।" : "Add your farm — booking will be faster."}</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <a href="/farm" className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-button border border-brand-300 bg-white px-4 py-2.5 text-[13px] font-semibold text-accent transition hover:bg-surface-subdued focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] sm:flex-none">
            {t("myFarm", lang)}
          </a>
          <Button onClick={() => searchRef.current?.focus()} className="min-h-[44px] flex-1 justify-center gap-1.5 rounded-button bg-action text-white shadow-button hover:bg-action-hover sm:flex-none">
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
            className="fixed inset-0 z-50 flex items-end justify-center bg-surface-overlay p-4 backdrop-blur-sm sm:items-center"
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
              className="max-h-[85vh] w-full max-w-lg overflow-hidden rounded-card border border-surface-border bg-white shadow-xl focus-visible:outline-none"
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
                  className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-stone-800 shadow hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
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
                  {formErrs.farm && <p id="bk-farm-err" role="alert" className="mt-1 text-xs font-medium text-danger-text">{formErrs.farm}</p>}
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
                  {formErrs.date && <p role="alert" className="mt-1 text-xs font-medium text-danger-text">{formErrs.date}</p>}
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
                  {formErrs.area && <p role="alert" className="mt-1 text-xs font-medium text-danger-text">{formErrs.area}</p>}
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
                  <Button type="submit" className="min-h-[44px] flex-[3] justify-center gap-1.5 rounded-button bg-action py-3 text-[15px] font-bold shadow-button" loading={busy}>
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
        <h2 className="flex items-center gap-2 px-1 text-[16px] font-bold text-stone-800">
          <ClipboardList className="h-5 w-5 text-link" aria-hidden /> {t("myBookings", lang)}{" "}
          <Badge className="bg-brand-50 text-link">{bookings.length}</Badge>
        </h2>
        {loading && !loadError ? (
          <Card>
            <Skeleton className="h-16 w-full" />
          </Card>
        ) : bookings.length === 0 ? (
          <EmptyState
            icon={<ClipboardList className="h-10 w-10 text-stone-300" aria-hidden />}
            title={t("noBookings", lang)}
            description={t("svcBookingEmptyHint", lang)}
          />
        ) : (
          <div className="space-y-3">
            {bookings.map((b) => (
              <Card key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border-surface-border">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-stone-800">
                    {b.service?.name ?? b.bookingNo}
                    <Badge className={`${b.status === "CANCELLED" ? "bg-danger-bg text-danger-text" : b.status === "COMPLETED" ? "bg-success-bg text-success-text" : "bg-amber-100 text-warning-text"} border`}>
                      {bookingStatusLabel(b.status, lang)}
                    </Badge>
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    {formatDateTime(b.scheduledFor, lang)} · {b.farm?.name} · {t("estimatedPrice", lang)}: <span className="font-semibold text-success-text">{formatBDT(b.estimatedPricePaisa, lang)}</span>
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
