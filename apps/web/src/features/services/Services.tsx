import { useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { api } from "../../lib/api";
import type { BookingWithRelations, FarmListItem, ServiceWithProviders } from "../../lib/api-types";
import { invalidate, useResource } from "../../lib/useResource";
import { RESOURCE_KEYS } from "../../lib/resourceKeys";
import { useSession } from "../../lib/session";
import { t } from "../../lib/i18n";
import { formatBDT, formatDateTime } from "../../lib/format";
import { bookingStatusLabel, serviceCategoryLabel } from "../../lib/labels";
import { mapError } from "../../lib/errors-ui";
import { track } from "../../lib/analytics";
import { ClipboardList, Search, SlidersHorizontal, Tractor, TriangleAlert, CheckCircle2, CalendarClock, ArrowRight, ShieldCheck, Leaf, Wrench, Phone } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorBanner, Input, Label, Modal, SectionHeader, Select, Skeleton, useConfirm, useToast } from "../../components/ui";
import { ServiceCard, ServiceCardSkeleton } from "../../components/service/ServiceCard";

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

/**
 * Failure UI for one resource: its own mapped error text plus a retry, shown
 * where that resource's data would be. Only the block that owns the failed
 * resource shows it — every block whose data arrived keeps rendering.
 */
function BlockError({ error, retryLabel, onRetry }: { error: string | null; retryLabel: string; onRetry: () => void }) {
  if (!error) return null;
  return (
    <div className="space-y-2">
      <ErrorBanner message={error} />
      <Button variant="outline" onClick={onRetry}>{retryLabel}</Button>
    </div>
  );
}

export default function Services() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const toast = useToast();
  const confirm = useConfirm();
  const searchRef = useRef<HTMLInputElement>(null);

  // The page reads three independent endpoints, so it holds three independent
  // resources: a failure in any one block leaves the others on screen.
  const servicesRes = useResource<ServiceWithProviders[]>("services", () => api<ServiceWithProviders[]>("GET", "/services"));
  const bookingsRes = useResource<BookingWithRelations[]>("services-bookings", () => api<BookingWithRelations[]>("GET", "/bookings"));
  const farmsRes = useResource<FarmListItem[]>(RESOURCE_KEYS.farms, () => api<FarmListItem[]>("GET", "/farms"));

  const services = servicesRes.data ?? [];
  const bookings = bookingsRes.data ?? [];
  const farms = farmsRes.data ?? [];

  const [selected, setSelected] = useState<ServiceWithProviders | null>(null);
  const [formErrs, setFormErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterKey>("ALL");
  type SortKey = "default" | "priceAsc" | "priceDesc";
  const [sort, setSort] = useState<SortKey>("default");

  // Search, category chips and price sort stay client-side over the catalogue
  // resource, exactly as they were over the state array.
  const filtered = useMemo(() => {
    let out = (servicesRes.data ?? []).filter((s) => {
      const cats = FILTER_MAP[activeFilter];
      const matchesFilter = activeFilter === "ALL" || cats.includes(s.category);
      const q = query.trim().toLowerCase();
      const matchesQ = !q || s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q) || (s.description ?? "").toLowerCase().includes(q);
      return matchesFilter && matchesQ;
    });
    if (sort === "priceAsc") out = [...out].sort((a, b) => a.basePricePaisa - b.basePricePaisa);
    if (sort === "priceDesc") out = [...out].sort((a, b) => b.basePricePaisa - a.basePricePaisa);
    return out;
  }, [servicesRes.data, activeFilter, query, sort]);

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
      // The new booking moves the bookings list and the provider assignment that
      // comes with it; the old page-wide `load()` refreshed all three resources,
      // so all three families are invalidated — no more, no less.
      invalidate("services");
      invalidate("services-bookings");
      invalidate("services-farms");
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      setBusy(false);
    }
  }

  async function cancelBooking(b: BookingWithRelations) {
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
      // Same refetch set as the old page-wide `load()`.
      invalidate("services");
      invalidate("services-bookings");
      invalidate("services-farms");
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="min-w-0 space-y-5">
      {/* SECTION 01 — HERO — concise, Bangla-first, field-rooted */}
      <section className="overflow-hidden rounded-card border border-surface-border bg-surface-card shadow-card">
        <div className="grid gap-6 p-6 sm:grid-cols-[1.2fr_0.8fr] sm:p-8">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-accent">
              <Leaf className="h-3.5 w-3.5" aria-hidden /> {t("svcBadgeVerified", lang)}
            </div>
            <h1 className="mt-3 text-balance text-2xl font-bold leading-8 tracking-[-0.02em] text-stone-800">
              {t("svcHeroTitle", lang)}
            </h1>
            <p className="mt-2 max-w-[52ch] text-sm leading-6 text-stone-600">
              {t("svcHeroSub", lang)}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={() => searchRef.current?.focus()}>
                {t("svcFindService", lang)} <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
              </Button>
              <span className="inline-flex items-center rounded-full bg-surface-subdued px-3 py-1 text-xs font-medium text-stone-600">
                {t("svcCount", lang, { n: services.length })}
              </span>
              {bookings.length > 0 && (
                <a href="#my-bookings" className="inline-flex min-h-[36px] items-center rounded-full px-3 text-xs font-semibold text-link hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]">
                  {t("myBookings", lang)} ↓
                </a>
              )}
            </div>
          </div>
          <div className="hidden sm:flex items-center justify-center rounded-2xl bg-surface-subdued p-4">
            <div className="grid w-full max-w-[280px] gap-3">
              <div className="flex items-center gap-3 rounded-button border border-surface-border bg-surface-card px-3 py-3 shadow-sm">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning-bg text-warning-text ring-1 ring-warning-border"><Tractor className="h-5 w-5" /></span>
                <div className="min-w-0"><p className="text-sm font-semibold text-stone-800">{t("svcFilterMech", lang)}</p><p className="text-xs text-stone-500">5 {t("svcTypesPlural", lang)}</p></div>
                <ArrowRight className="ml-auto h-4 w-4 text-stone-500" aria-hidden />
              </div>
              <div className="flex items-center gap-3 rounded-button border border-surface-border bg-surface-card px-3 py-3 shadow-sm">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-info-bg text-info-text ring-1 ring-info-border"><Wrench className="h-5 w-5" /></span>
                <div className="min-w-0"><p className="text-sm font-semibold text-stone-800">{t("svcFilterAdvisory", lang)}</p><p className="text-xs text-stone-500">2 {t("svcTypesPlural", lang)}</p></div>
                <CheckCircle2 className="ml-auto h-4 w-4 text-link" aria-hidden />
              </div>
              <div className="flex items-center gap-3 rounded-button border border-surface-border bg-surface-card px-3 py-3 shadow-sm">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-enterprise-soil-50 text-warning-text ring-1 ring-warning-border"><ShieldCheck className="h-5 w-5" /></span>
                <div className="min-w-0"><p className="text-sm font-semibold text-stone-800">{t("svcFilterTest", lang)}</p><p className="text-xs text-stone-500">1 {t("svcTypeSingular", lang)}</p></div>
                <span className="ml-auto text-xs font-bold text-link">{t("svcClearLabel", lang)}</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Farms — the "add a farm first" hint and its failure share this slot, so
          neither the catalogue nor the bookings go down with them. */}
      <BlockError error={farmsRes.error} retryLabel={t("retry", lang)} onRetry={() => void farmsRes.reload()} />

      {!farmsRes.loading && !farmsRes.error && farms.length === 0 && (
        <Card className="flex items-center gap-2 border-warning-border bg-warning-bg text-sm font-medium text-warning-text">
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden /> {t("needFarmFirst", lang)}
          <Link to="/farm" className="ml-auto inline-flex min-h-[44px] items-center text-xs font-bold underline hover:no-underline"> {t("myFarm", lang)} →</Link>
        </Card>
      )}

      {/* SECTION 02 — SERVICE DISCOVERY */}
      <section aria-labelledby="discover-title" className="space-y-3">
        <h2 id="discover-title" className="sr-only">{t("svcDiscoverSr", lang)}</h2>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" aria-hidden />
          <input
            ref={searchRef}
            type="search"
            placeholder={t("svcSearchPh", lang)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-[44px] w-full rounded-button border border-surface-border bg-surface-card pl-10 pr-4 text-sm font-medium text-stone-800 placeholder:text-stone-500 shadow-sm focus:border-action focus:outline-none focus:ring-2 focus:ring-brand-200"
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
              className={`inline-flex min-h-[44px] items-center rounded-full px-3.5 py-2 text-sm font-semibold transition active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] focus-visible:ring-offset-2 ring-offset-[var(--color-surface-bg)] ${activeFilter === k ? "bg-action text-white shadow-sm" : "bg-surface-card text-stone-600 ring-1 ring-surface-border-strong hover:bg-brand-50 hover:text-accent"}`}
            >
              {t(CHIP_KEY[k], lang)}
            </button>
          ))}
          <label className="ml-auto flex items-center gap-2">
            <span className="sr-only">{t("svcSortLabel", lang)}</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="min-h-[44px] rounded-button border border-surface-border bg-surface-card px-3 py-2 text-sm font-medium text-stone-800 focus:border-action focus:outline-none focus:ring-2 focus:ring-brand-200"
              aria-label={t("svcSortLabel", lang)}
            >
              <option value="default">{t("svcSortLabel", lang)}</option>
              <option value="priceAsc">{t("svcSortAsc", lang)}</option>
              <option value="priceDesc">{t("svcSortDesc", lang)}</option>
            </select>
          </label>
        </div>
        <p className="px-1 text-xs font-medium text-stone-500" aria-live="polite">
          {t("svcCount", lang, { n: filtered.length })}{query || activeFilter !== "ALL" ? ` ${t("svcFoundWord", lang)}` : ""}
        </p>
      </section>

      {/* SECTION 05 — ALL SERVICES — 1col mobile, 2-col tablet, 3-col desktop, 20px gap */}
      <BlockError error={servicesRes.error} retryLabel={t("retry", lang)} onRetry={() => void servicesRes.reload()} />

      {servicesRes.loading ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <ServiceCardSkeleton key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        // A failed catalogue must not read as "no services exist".
        servicesRes.error ? null : (
          <EmptyState
            title={t("svcEmptyTitle", lang)}
            description={t("svcEmptyHint", lang)}
          />
        )
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
      <section aria-labelledby="how-title" className="rounded-card border border-surface-border bg-surface-card p-6 shadow-sm sm:p-8">
        <h2 id="how-title" className="text-lg font-bold tracking-[-0.01em] text-stone-800">
          {t("svcHowTitle", lang)}
        </h2>
        <p className="mt-1 text-sm leading-5 text-stone-600">{t("svcHowSub", lang)}</p>
        <ol className="mt-6 grid gap-6 sm:grid-cols-3">
          <li className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-link ring-1 ring-brand-100" aria-hidden>
              <Search className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-stone-800">{t("svcHowStep1Title", lang)}</p>
              <p className="mt-1 text-sm leading-5 text-stone-600">{t("svcHowStep1Body", lang)}</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-link ring-1 ring-brand-100" aria-hidden>
              <CalendarClock className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-stone-800">{t("svcHowStep2Title", lang)}</p>
              <p className="mt-1 text-sm leading-5 text-stone-600">{t("svcHowStep2Body", lang)}</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-link ring-1 ring-brand-100" aria-hidden>
              <CheckCircle2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-stone-800">{t("svcHowStep3Title", lang)}</p>
              <p className="mt-1 text-sm leading-5 text-stone-600">{t("svcHowStep3Body", lang)}</p>
            </div>
          </li>
        </ol>
      </section>

      {/* SECTION 07 — TRUST — real claims only */}
      <section aria-labelledby="trust-title" className="rounded-card border border-surface-border bg-surface-subdued p-6 sm:p-8">
        <h2 id="trust-title" className="text-lg font-bold tracking-[-0.01em] text-stone-800">
          {t("svcWhyTitle", lang)}
        </h2>
        <ul className="mt-4 grid gap-4 sm:grid-cols-3">
          <li className="flex gap-3 rounded-2xl border border-surface-border bg-surface-card p-4 shadow-sm">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-link" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-stone-800">{t("svcTrustVerifiedTitle", lang)}</p>
              <p className="mt-1 text-sm leading-5 text-stone-600">{t("svcTrustVerifiedBody", lang)}</p>
            </div>
          </li>
          <li className="flex gap-3 rounded-2xl border border-surface-border bg-surface-card p-4 shadow-sm">
            <Leaf className="mt-0.5 h-5 w-5 shrink-0 text-link" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-stone-800">{t("svcTrustPriceTitle", lang)}</p>
              <p className="mt-1 text-sm leading-5 text-stone-600">{t("svcTrustPriceBody", lang)}</p>
            </div>
          </li>
          <li className="flex gap-3 rounded-2xl border border-surface-border bg-surface-card p-4 shadow-sm">
            <Phone className="mt-0.5 h-5 w-5 shrink-0 text-link" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-stone-800">{t("svcTrustSupportTitle", lang)}</p>
              <p className="mt-1 text-sm leading-5 text-stone-600">{t("svcTrustSupportBody", lang)}</p>
            </div>
          </li>
        </ul>
      </section>

      {/* SECTION 08 — FINAL CTA — existing working action */}
      <section className="flex flex-col items-start gap-3 rounded-card border border-brand-200 bg-brand-50 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-[-0.01em] text-accent">{t("svcHelpTitle", lang)}</h2>
          <p className="mt-1 text-sm leading-5 text-stone-600">{t("svcHelpBody", lang)}</p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Link to="/farm" className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-button border border-brand-300 bg-surface-card px-4 py-2.5 text-sm font-semibold text-accent transition hover:bg-surface-subdued focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] sm:flex-none">
            {t("myFarm", lang)}
          </Link>
          <Button onClick={() => searchRef.current?.focus()} className="flex-1 sm:flex-none">
            {t("svcFindServices", lang)} <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </section>

      {/* Booking dialog — shared Modal (focus trap, scroll lock, Escape, focus restore) */}
      {selected && (
        <Modal title={selected.name} onClose={() => setSelected(null)} closeLabel={t("close", lang)}>
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
            className="mb-3 h-28 w-full rounded-xl object-cover"
          />
          <p className="mb-4 text-xs font-medium text-stone-500">
            {formatBDT(selected.basePricePaisa, lang)} · {serviceCategoryLabel(selected.category, lang)}
          </p>
          <form onSubmit={book} noValidate className="grid gap-4 sm:grid-cols-2">
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
              <Button type="submit" className="min-h-[44px] flex-[3] justify-center gap-1.5 py-3" loading={busy}>
                {t("submit", lang)} <span aria-hidden>→</span>
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* My bookings — real data, no fabricated timeline */}
      <section id="my-bookings" className="scroll-mt-20 space-y-3">
        <SectionHeader
          title={t("myBookings", lang)}
          action={<Badge tone="brand">{bookings.length}</Badge>}
        />
        <BlockError error={bookingsRes.error} retryLabel={t("retry", lang)} onRetry={() => void bookingsRes.reload()} />
        {bookingsRes.loading ? (
          <Card>
            <Skeleton className="h-16 w-full" />
          </Card>
        ) : bookings.length === 0 ? (
          // A failed list must not read as "no bookings".
          bookingsRes.error ? null : (
            <EmptyState
              icon={<ClipboardList className="h-10 w-10 text-stone-300" aria-hidden />}
              title={t("noBookings", lang)}
              description={t("svcBookingEmptyHint", lang)}
            />
          )
        ) : (
          <div className="space-y-3">
            {bookings.map((b) => (
              <Card key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border-surface-border">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-stone-800">
                    {b.service?.name ?? b.bookingNo}
                    <Badge tone={b.status === "CANCELLED" ? "danger" : b.status === "COMPLETED" ? "success" : "warning"}>
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
