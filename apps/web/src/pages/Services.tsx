import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";
import { formatBDT, formatDateTime } from "../lib/format.js";
import { bookingStatusLabel, priceUnitLabel, serviceCategoryLabel } from "../lib/labels.js";
import { mapError } from "../lib/errors-ui.js";
import { track } from "../lib/analytics.js";
import {
  Badge, Button, Card, EmptyState, ErrorBanner, Input, Label, Select, Skeleton, useConfirm, useToast,
} from "../components/ui.jsx";

interface Service {
  id: string;
  code: string;
  name: string;
  category: string;
  basePricePaisa: number;
  priceUnit: string;
  description?: string;
  providers: { id: string; name: string; district?: string; ratingCount: number }[];
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
    const okToCancel = await confirm({
      title: t("cancelBooking", lang),
      body: `${b.service?.name ?? ""} · ${formatDateTime(b.scheduledFor, lang)} — ${t("cancelBookingBody", lang)}`,
      danger: true,
      confirmLabel: t("cancel", lang),
      cancelLabel: t("back", lang),
    });
    if (!okToCancel) return;
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
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-stone-800"><span aria-hidden>🚜</span> {t("services", lang)}</h1>
      {loadError && (
        <div className="space-y-2">
          <ErrorBanner message={loadError} />
          <Button variant="outline" onClick={() => void load()}>{t("retry", lang)}</Button>
        </div>
      )}
      {!loading && !loadError && farms.length === 0 && (
        <Card className="bg-amber-50 text-sm text-amber-800">
          <span aria-hidden>⚠️</span> {t("needFarmFirst", lang)}
        </Card>
      )}

      {loading && !loadError ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <Card key={i} className="flex items-center justify-between"><Skeleton className="h-14 w-full" /></Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {services.map((s) => (
            <Card key={s.id} className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-bold text-stone-800">{s.name}</h3>
                <Badge className="bg-stone-100 text-stone-500">{serviceCategoryLabel(s.category, lang)}</Badge>
                <p className="mt-1 text-sm font-semibold text-green-800">
                  {formatBDT(s.basePricePaisa, lang)}{" "}
                  <span className="text-[10px] font-normal text-stone-400">{priceUnitLabel(s.priceUnit, lang)}</span>
                </p>
              </div>
              <Button onClick={() => { setFormErrs({}); setSelected(s); }} disabled={farms.length === 0}>
                {t("bookNow", lang)}
              </Button>
            </Card>
          ))}
        </div>
      )}

      {selected && (
        <Card className="space-y-3 border-green-300">
          <h3 className="font-bold text-green-900">{selected.name} — {t("bookNow", lang)}</h3>
          <form onSubmit={book} noValidate className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="bk-farm">{t("farmLabel", lang)}</Label>
              <Select id="bk-farm" name="farm" defaultValue="" aria-invalid={Boolean(formErrs.farm)}>
                <option value="" disabled>{t("farmLabel", lang)}</option>
                {farms.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </Select>
              {formErrs.farm && <p role="alert" className="mt-1 text-xs text-red-600">{formErrs.farm}</p>}
            </div>
            <div>
              <Label htmlFor="bk-date">{t("scheduleLabel", lang)}</Label>
              <Input id="bk-date" name="date" type="datetime-local" min={new Date().toISOString().slice(0, 16)} aria-invalid={Boolean(formErrs.date)} />
              {formErrs.date && <p role="alert" className="mt-1 text-xs text-red-600">{formErrs.date}</p>}
            </div>
            <div>
              <Label htmlFor="bk-area">{t("areaBigha", lang)}</Label>
              <Input id="bk-area" name="area" type="number" step="0.1" min="0.1" aria-invalid={Boolean(formErrs.area)} />
              {formErrs.area && <p role="alert" className="mt-1 text-xs text-red-600">{formErrs.area}</p>}
            </div>
            <div>
              <Label htmlFor="bk-provider">{t("providerLabel", lang)}</Label>
              <Select id="bk-provider" name="provider" defaultValue="">
                <option value="">{t("providerDefaultOption", lang)}</option>
                {selected.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.district ? ` · ${p.district}` : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="button" variant="outline" className="flex-1" aria-label={t("cancel", lang)} onClick={() => setSelected(null)}>
                ✕ <span className="sr-only">{t("cancel", lang)}</span>
              </Button>
              <Button type="submit" className="flex-[3]" loading={busy}>{t("submit", lang)}</Button>
            </div>
          </form>
        </Card>
      )}

      {/* My bookings */}
      <section>
        <h2 className="mb-2 font-semibold text-stone-700"><span aria-hidden>📋</span> {t("myBookings", lang)}</h2>
        {loading && !loadError ? (
          <Card><Skeleton className="h-12 w-full" /></Card>
        ) : bookings.length === 0 ? (
          <EmptyState icon="📋" title={t("noBookings", lang)} />
        ) : (
          <div className="space-y-2">
            {bookings.map((b) => (
              <Card key={b.id} className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-stone-800">
                    {b.service?.name ?? b.bookingNo}
                    <Badge
                      className={`ml-2 align-middle ${
                        b.status === "CANCELLED"
                          ? "bg-red-100 text-red-700"
                          : b.status === "COMPLETED"
                            ? "bg-green-100 text-green-900"
                            : "bg-amber-100 text-amber-900"
                      }`}
                    >
                      {bookingStatusLabel(b.status, lang)}
                    </Badge>
                  </p>
                  <p className="mt-0.5 text-xs text-stone-400">
                    {formatDateTime(b.scheduledFor, lang)} · {b.farm?.name} ·{" "}
                    {t("estimatedPrice", lang)}: {formatBDT(b.estimatedPricePaisa, lang)}
                    {b.provider ? ` · ${t("providerLabel", lang)}: ${b.provider.name}` : ""}
                  </p>
                </div>
                {(b.status === "REQUESTED" || b.status === "ASSIGNED") && (
                  <Button variant="danger" size="sm" loading={cancellingId === b.id} onClick={() => void cancelBooking(b)}>
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
