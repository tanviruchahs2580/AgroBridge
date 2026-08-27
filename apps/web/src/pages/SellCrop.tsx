import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";
import type { DictKey } from "../lib/i18n.js";
import { formatBDT } from "../lib/format.js";
import { cropLabel, PROC_PIPELINE, procurementStatusLabel } from "../lib/labels.js";
import { mapError } from "../lib/errors-ui.js";
import { track } from "../lib/analytics.js";
import { Coins, Sprout } from "lucide-react";
import {
  Badge, Button, Card, EmptyState, ErrorBanner, Input, Label, Select, Skeleton, Stepper, useConfirm, useToast,
} from "../components/ui.jsx";

interface ProcurementOrder {
  id: string;
  poNo: string;
  cropName: string;
  quantityKg: number;
  qualityGrade: string;
  netPayablePaisa: number;
  status: string;
}

const CROPS = ["RICE", "WHEAT", "JUTE", "MUSTARD", "MAIZE", "POTATO"] as const;
const CROP_KEYS: Record<string, DictKey> = {
  RICE: "cropRICE", WHEAT: "cropWHEAT", JUTE: "cropJUTE",
  MUSTARD: "cropMUSTARD", MAIZE: "cropMAIZE", POTATO: "cropPOTATO",
};
const PIPE_KEYS: Record<string, DictKey> = {
  SUBMITTED: "pipeSUBMITTED", QC: "pipeQC", PURCHASE_ORDER: "pipePO",
  COLLECTED: "pipeCOLLECTED", PAID: "pipePAID",
};
const GRADE_KEYS: Record<string, DictKey> = { A: "gradeA", B: "gradeB", C: "gradeC" };

export default function SellCrop() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const toast = useToast();
  const confirm = useConfirm();

  const [farms, setFarms] = useState<{ id: string; name: string }[]>([]);
  const [orders, setOrders] = useState<ProcurementOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formErrs, setFormErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setOrders(await api<ProcurementOrder[]>("GET", "/procurement"));
    } catch (err) {
      setLoadError(mapError(err, lang));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        setFarms(await api<{ id: string; name: string }[]>("GET", "/farms"));
      } catch (err) {
        setLoadError(mapError(err, lang));
      }
      await load();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const errs: Record<string, string> = {};
    if (!fd.get("farm")) errs.farm = t("errFieldRequired", lang);
    if (!fd.get("crop")) errs.crop = t("errFieldRequired", lang);
    const qty = Number(fd.get("qty"));
    if (!qty || qty < 1) errs.qty = t("errAmountInvalid", lang);
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
      await load();
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="flex items-center gap-2 text-xl font-bold text-stone-800"><Coins className="h-6 w-6 text-green-700" aria-hidden /> {t("sellCrop", lang)}</h1>
      {loadError && (
        <div className="space-y-2">
          <ErrorBanner message={loadError} />
          <Button variant="outline" onClick={() => void load()}>{t("retry", lang)}</Button>
        </div>
      )}

      <Card>
        <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="of-farm">{t("farmLabel", lang)}</Label>
            <Select id="of-farm" name="farm" defaultValue="" onChange={() => setFormErrs((prev) => { const n = { ...prev }; delete n.farm; return n; })} aria-invalid={Boolean(formErrs.farm)} aria-describedby={formErrs.farm ? "of-farm-err" : undefined}>
              <option value="" disabled>{t("farmLabel", lang)}</option>
              {farms.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </Select>
            {formErrs.farm && <p id="of-farm-err" role="alert" className="mt-1 text-xs text-red-600">{formErrs.farm}</p>}
          </div>
          <div>
            <Label htmlFor="of-crop">{t("cropName", lang)}</Label>
            <Select id="of-crop" name="crop" defaultValue="" onChange={() => setFormErrs((prev) => { const n = { ...prev }; delete n.crop; return n; })} aria-invalid={Boolean(formErrs.crop)} aria-describedby={formErrs.crop ? "of-crop-err" : undefined}>
              <option value="" disabled>{t("cropName", lang)}</option>
              {CROPS.map((c) => (
                <option key={c} value={c}>{t(CROP_KEYS[c], lang)}</option>
              ))}
            </Select>
            {formErrs.crop && <p id="of-crop-err" role="alert" className="mt-1 text-xs text-red-600">{formErrs.crop}</p>}
          </div>
          <div>
            <Label htmlFor="of-qty">{t("quantityKg", lang)}</Label>
            <Input id="of-qty" name="qty" type="number" min="1" step="1" onChange={() => setFormErrs((prev) => { const n = { ...prev }; delete n.qty; return n; })} onBlur={(e) => { const v = Number((e.target as HTMLInputElement).value); if (v && v < 1) setFormErrs((prev) => ({ ...prev, qty: t("errAmountInvalid", lang) })); }} aria-invalid={Boolean(formErrs.qty)} aria-describedby={formErrs.qty ? "of-qty-err" : undefined} />
            {formErrs.qty && <p id="of-qty-err" role="alert" className="mt-1 text-xs text-red-600">{formErrs.qty}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="of-moisture">{t("moisturePct", lang)}</Label>
              <Input id="of-moisture" name="moisture" type="number" min="0" max="60" step="0.5" onChange={() => setFormErrs((prev) => { const n = { ...prev }; delete n.moisture; return n; })} aria-invalid={Boolean(formErrs.moisture)} aria-describedby={formErrs.moisture ? "of-moisture-err" : undefined} />
              {formErrs.moisture && <p id="of-moisture-err" role="alert" className="mt-1 text-xs text-red-600">{formErrs.moisture}</p>}
            </div>
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
          {farms.length === 0 && !loading && (
            <p className="text-xs text-stone-500 sm:col-span-2">{t("needFarmFirst", lang)}</p>
          )}
        </form>
      </Card>

      <h2 className="pt-2 font-semibold text-stone-700">{t("myOffers", lang)}</h2>
      {loading ? (
        <Card><Skeleton className="h-16 w-full" /></Card>
      ) : orders.length === 0 ? (
        <EmptyState icon={<Sprout className="h-10 w-10 text-stone-300" aria-hidden />} title={t("noOffers", lang)} />
      ) : (
        <div className="space-y-2">
          {orders.map((o) => {
            if (o.status === "REJECTED") {
              return (
                <Card key={o.id} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="break-words font-bold text-stone-800 [overflow-wrap:anywhere]">{cropLabel(o.cropName, lang)}</span> · {o.quantityKg} {t("kgUnit", lang)} ·{" "}
                      {t(GRADE_KEYS[o.qualityGrade] ?? "qualityGrade", lang)}
                      <p className="break-all text-xs text-stone-500 [overflow-wrap:anywhere]">{o.poNo}</p>
                    </div>
                    <div className="flex items-center gap-2 text-right">
                      <p className="font-bold text-green-800">{formatBDT(o.netPayablePaisa, lang)}</p>
                      <Badge className="bg-red-100 text-red-700">{procurementStatusLabel(o.status, lang)}</Badge>
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
                    {t(GRADE_KEYS[o.qualityGrade] ?? "qualityGrade", lang)}
                    <p className="break-all text-xs text-stone-500 [overflow-wrap:anywhere]">{o.poNo}</p>
                  </div>
                  <p className="font-bold text-green-800">{formatBDT(o.netPayablePaisa, lang)}</p>
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
  );
}
