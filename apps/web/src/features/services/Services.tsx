import { useMemo, useState } from "react";
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
import { ClipboardList, Search, SlidersHorizontal, TriangleAlert, Wrench } from "lucide-react";
import { Badge, BlockError, Button, Card, EmptyState, Input, Label, Modal, PageHeader, SectionHeader, Select, Skeleton, useConfirm, useToast } from "../../components/ui";
import { ServiceCard, ServiceCardSkeleton } from "../../components/service/ServiceCard";
import { serviceHeroImage } from "../../components/service/heroImages";

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

/**
 * `YYYY-MM-DDTHH:mm` for a `<input type="datetime-local">`, in the user's own
 * timezone. `toISOString().slice(0, 16)` produces UTC, which is the wrong wall
 * clock for the picker's `min`/`max` bounds anywhere east or west of Greenwich.
 */
function localDateTimeInput(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

  // The page reads three independent endpoints, so it holds three independent
  // resources: a failure in any one block leaves the others on screen.
  const servicesRes = useResource<ServiceWithProviders[]>("services", () => api<ServiceWithProviders[]>("GET", "/services"));
  const bookingsRes = useResource<BookingWithRelations[]>("services-bookings", () => api<BookingWithRelations[]>("GET", "/bookings"));
  const farmsRes = useResource<FarmListItem[]>(RESOURCE_KEYS.farms, () => api<FarmListItem[]>("GET", "/farms"));

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
    if (!selected || busy) return;
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
      // Exactly what a booking moves: the bookings list it adds to. The
      // catalogue (`services`) and the farm list (`farms`) are inputs to this
      // dialog, not outputs of it — POST /bookings touches neither, so
      // invalidating them refetched the whole catalogue (up to 32 service rows,
      // each re-mounted) for nothing, on the screen the user is still reading.
      invalidate("services-bookings");
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      setBusy(false);
    }
  }

  async function cancelBooking(b: BookingWithRelations) {
    if (cancellingId) return;
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
      // Same reasoning as booking: a status change moves the bookings list only.
      // The catalogue row is not touched by it, so it is not refetched.
      invalidate("services-bookings");
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="min-w-0 space-y-5">
      {/* The page opens on the catalogue. Before this it opened on a hero — a
          "Platform-listed" badge, a slogan headline, a subtitle, a "Find a
          service" button that focused the search field below, a service count,
          and a summary panel counting the categories the filter chips already
          name. Three further sections followed the grid: "How it works" (three
          steps describing the booking dialog), "Why AgroBridge" (three claims),
          and a closing CTA. None of it was state and none of it was an action
          the page did not already offer — a farmer opening Services wants the
          list and the search field, which is where the page now starts. */}
      <PageHeader icon={<Wrench className="h-5 w-5" aria-hidden />} title={t("services", lang)} />

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
            type="search"
            placeholder={t("svcSearchPh", lang)}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // Focus ring comes from the token ring like every other control on the app;
            // this field cannot simply reuse <Input> because the leading search icon
            // needs its own left padding, and overriding px on a utility-driven input
            // resolves by CSS order rather than by class order.
            className="h-11 w-full rounded-input border border-surface-border-strong bg-surface-card pl-10 pr-4 text-sm font-medium text-stone-800 placeholder:text-stone-500 shadow-sm focus:border-brand-500 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] focus-visible:ring-offset-2 ring-offset-[var(--color-surface-bg)]"
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
              className="min-h-[44px] rounded-input border border-surface-border-strong bg-surface-card px-3 py-2 text-sm font-medium text-stone-800 focus:border-brand-500 focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]"
              aria-label={t("svcSortLabel", lang)}
            >
              {/* The default option names the ordering, not the field's label:
                  an option reading "Sort" inside a control already labelled
                  "Sort" read as a second label rather than as the state. */}
              <option value="default">{t("svcSortDefault", lang)}</option>
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
          <EmptyState title={t("svcEmptyTitle", lang)} />
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
              />
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* The three sections that stood here — how it works, why AgroBridge, and
          a closing CTA — were marketing copy on an authenticated utility screen.
          The steps described the booking dialog the user reaches from any card,
          the trust cards made claims the catalogue cannot evidence from the
          client, and the CTA offered a second door to the search field that is
          now the first thing on the page. */}

      {/* Booking dialog — shared Modal (focus trap, scroll lock, Escape, focus restore) */}
      {selected && (
        <Modal title={selected.name} onClose={() => setSelected(null)} closeLabel={t("close", lang)}>
          <img
            src={serviceHeroImage(selected.category)}
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
                  {t("selectFarmPrompt", lang)}
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
                // Local wall-clock, not `toISOString()` (which is UTC): in UTC+6 the
                // picker's minimum would sit six hours in the past, offering slots the
                // submit handler then rejects, and the browser's own validity styling
                // would contradict the app's rule.
                min={localDateTimeInput(Date.now())}
                onChange={() => setFormErrs((p) => { const n = { ...p }; delete n.date; return n; })}
                aria-invalid={Boolean(formErrs.date)}
                aria-describedby={formErrs.date ? "bk-date-err" : undefined}
              />
              {formErrs.date && <p id="bk-date-err" role="alert" className="mt-1 text-xs font-medium text-danger-text">{formErrs.date}</p>}
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
                aria-describedby={formErrs.area ? "bk-area-err" : undefined}
              />
              {formErrs.area && <p id="bk-area-err" role="alert" className="mt-1 text-xs font-medium text-danger-text">{formErrs.area}</p>}
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
              headingLevel={3}
              icon={<ClipboardList className="h-10 w-10 text-stone-300" aria-hidden />}
              title={t("noBookings", lang)}
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
