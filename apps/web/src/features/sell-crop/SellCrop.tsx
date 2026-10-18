import { useState } from "react";
import { api } from "../../lib/api";
import type { FarmListItem, ProcurementListItem } from "../../lib/api-types";
import { invalidate, useResource } from "../../lib/useResource";
import { useSession } from "../../lib/session";
import { t } from "../../lib/i18n";
import type { DictKey } from "../../lib/i18n";
import { formatBDT } from "../../lib/format";
import { CROP_KEYS, cropLabel, PROC_PIPELINE, procurementStatusLabel } from "../../lib/labels";
import { mapError } from "../../lib/errors-ui";
import { track } from "../../lib/analytics";
import { Coins, Sprout } from "lucide-react";
import {
  Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, Label, PageHeader, SectionHeader, Select, Skeleton, Stepper, useConfirm, useToast,
} from "../../components/ui";

const CROPS = ["RICE", "WHEAT", "JUTE", "MUSTARD", "MAIZE", "POTATO"] as const;
const PIPE_KEYS: Record<string, DictKey> = {
  SUBMITTED: "pipeSUBMITTED", QC: "pipeQC", PURCHASE_ORDER: "pipePO",
  COLLECTED: "pipeCOLLECTED", PAID: "pipePAID",
};
const GRADE_KEYS: Record<string, DictKey> = { A: "gradeA", B: "gradeB", C: "gradeC" };

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

export default function SellCrop() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const toast = useToast();
  const confirm = useConfirm();

  // The farm selector and the offers list come from two separate endpoints
  // (GET /farms and GET /procurement), so they are two resources: a failed farm
  // fetch no longer blanks the offers list, and vice versa.
  const farmsRes = useResource<FarmListItem[]>("sell-crop-farms", () => api<FarmListItem[]>("GET", "/farms"));
  const offersRes = useResource<ProcurementListItem[]>("sell-crop-offers", () => api<ProcurementListItem[]>("GET", "/procurement"));

  const farms = farmsRes.data ?? [];
  const orders = offersRes.data ?? [];

  const [formErrs, setFormErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const errs: Record<string, string> = {};
    if (!fd.get("farm")) errs.farm = t("errFieldRequired", lang);
    if (!fd.get("crop")) errs.crop = t("errFieldRequired", lang);
    const qty = Number(fd.get("qty"));
    if (!qty || qty < 1) errs.qty = t("errQuantityInvalid", lang);
    const moistureRaw = fd.get("moisture") as string;
    if (moistureRaw && (Number(moistureRaw) < 0 || Number(moistureRaw) > 60)) errs.moisture = t("errValidation", lang);
    setFormErrs(errs);
    if (Object.keys(errs).length > 0 || !farms.length) return;

    const cropValue = String(fd.get("crop"));
    const okToSubmit = await confirm({
      title: t("submitOfferTitle", lang),
      body: t("submitOfferBody", lang, {
        crop: t(CROP_KEYS[cropValue], lang),
        qty,
        unit: t("kgUnit", lang),
      }),
      confirmLabel: t("submit", lang),
      cancelLabel: t("cancel", lang),
    });
    if (!okToSubmit) return;

    setBusy(true);
    try {
      await api("POST", "/procurement/offers", {
        farmId: fd.get("farm"),
        cropName: cropValue,
        quantityKg: qty,
        moisturePct: moistureRaw ? Number(moistureRaw) : undefined,
        qualityGrade: fd.get("grade"),
      });
      track("offer_submitted", { crop: cropValue });
      toast.success(t("offerSubmittedToast", lang));
      form.reset();
      // The old code awaited load(), which refetched the offers list only —
      // the farm list was never part of that refetch.
      invalidate("sell-crop-offers");
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader icon={<Coins className="h-5 w-5" aria-hidden />} title={t("sellCrop", lang)} />

      {/* A failed farm list shows its own error with retry here; the form stays
          on screen and the "add a farm first" hint is suppressed, so a failure
          never reads as "you have no farms". */}
      <BlockError error={farmsRes.error} retryLabel={t("retry", lang)} onRetry={() => void farmsRes.reload()} />

      <Card>
        <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
          <Field label={t("farmLabel", lang)} htmlFor="of-farm" error={formErrs.farm} required>
            <Select id="of-farm" name="farm" defaultValue="" onChange={() => setFormErrs((prev) => { const n = { ...prev }; delete n.farm; return n; })} aria-invalid={Boolean(formErrs.farm)} aria-describedby={formErrs.farm ? "of-farm-err" : undefined}>
              <option value="" disabled>{t("farmLabel", lang)}</option>
              {farms.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("cropName", lang)} htmlFor="of-crop" error={formErrs.crop} required>
            <Select id="of-crop" name="crop" defaultValue="" onChange={() => setFormErrs((prev) => { const n = { ...prev }; delete n.crop; return n; })} aria-invalid={Boolean(formErrs.crop)} aria-describedby={formErrs.crop ? "of-crop-err" : undefined}>
              <option value="" disabled>{t("cropName", lang)}</option>
              {CROPS.map((c) => (
                <option key={c} value={c}>{t(CROP_KEYS[c], lang)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t("quantityKg", lang)} htmlFor="of-qty" error={formErrs.qty} required>
            <Input id="of-qty" name="qty" type="number" min="1" step="1" onChange={() => setFormErrs((prev) => { const n = { ...prev }; delete n.qty; return n; })} onBlur={(e) => { const v = Number((e.target as HTMLInputElement).value); if (v && v < 1) setFormErrs((prev) => ({ ...prev, qty: t("errQuantityInvalid", lang) })); }} aria-invalid={Boolean(formErrs.qty)} aria-describedby={formErrs.qty ? "of-qty-err" : undefined} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("moisturePct", lang)} htmlFor="of-moisture" error={formErrs.moisture}>
              <Input id="of-moisture" name="moisture" type="number" min="0" max="60" step="0.5" onChange={() => setFormErrs((prev) => { const n = { ...prev }; delete n.moisture; return n; })} aria-invalid={Boolean(formErrs.moisture)} aria-describedby={formErrs.moisture ? "of-moisture-err" : undefined} />
            </Field>
            <div>
              <Label htmlFor="of-grade">{t("qualityGrade", lang)}</Label>
              <Select id="of-grade" name="grade" defaultValue="A">
                {(["A", "B", "C"] as const).map((g) => (
                  <option key={g} value={g}>{t(GRADE_KEYS[g], lang)}</option>
                ))}
              </Select>
            </div>
          </div>
          <Button type="submit" className="sm:col-span-2" loading={busy} disabled={farms.length === 0}>
            {t("submit", lang)}
          </Button>
          {farms.length === 0 && !farmsRes.loading && !farmsRes.error && (
            <p className="text-xs text-stone-500 sm:col-span-2">{t("needFarmFirst", lang)}</p>
          )}
        </form>
      </Card>

      <SectionHeader title={t("myOffers", lang)} className="pt-2" />
      <div className="space-y-2">
        {/* The offers list owns its own error with retry; a failed list is not
            shown as "no offers". */}
        <BlockError error={offersRes.error} retryLabel={t("retry", lang)} onRetry={() => void offersRes.reload()} />
        {offersRes.loading ? (
          <Card><Skeleton className="h-16 w-full" /></Card>
        ) : orders.length === 0 ? (
          offersRes.error ? null : (
            <EmptyState icon={<Sprout className="h-10 w-10 text-stone-300" aria-hidden />} title={t("noOffers", lang)} />
          )
        ) : (
          <div className="space-y-2">
            {orders.map((o) => {
              if (o.status === "REJECTED") {
                return (
                  <Card key={o.id} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="break-words font-bold text-stone-800 [overflow-wrap:anywhere]">{cropLabel(o.cropName, lang)}</span> · {o.quantityKg} {t("kgUnit", lang)} ·{" "}
                        {t(GRADE_KEYS[o.qualityGrade ?? ""] ?? "qualityGrade", lang)}
                        <p className="break-all text-xs text-stone-500 [overflow-wrap:anywhere]">{o.poNo}</p>
                      </div>
                      <div className="flex items-center gap-2 text-right">
                        <p className="font-bold text-stone-500">{formatBDT(o.netPayablePaisa, lang)}</p>
                        <Badge tone="danger">{procurementStatusLabel(o.status, lang)}</Badge>
                      </div>
                    </div>
                  </Card>
                );
              }
              const idx = PROC_PIPELINE.indexOf(o.status as (typeof PROC_PIPELINE)[number]);
              return (
                <Card key={o.id}>
                  <div className="mb-3 flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <span className="break-words font-bold text-stone-800 [overflow-wrap:anywhere]">{cropLabel(o.cropName, lang)}</span> · {o.quantityKg} {t("kgUnit", lang)} ·{" "}
                      {t(GRADE_KEYS[o.qualityGrade ?? ""] ?? "qualityGrade", lang)}
                      <p className="break-all text-xs text-stone-500 [overflow-wrap:anywhere]">{o.poNo}</p>
                    </div>
                    <p className="font-bold text-accent">{formatBDT(o.netPayablePaisa, lang)}</p>
                  </div>
                  <Stepper
                    steps={PROC_PIPELINE.map((stage, i) => ({
                      label: t(PIPE_KEYS[stage], lang),
                      state: i < idx ? "done" : i === idx ? "current" : "todo",
                    }))}
                  />
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
