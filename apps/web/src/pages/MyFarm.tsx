import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";
import type { DictKey } from "../lib/i18n.js";
import { cropLabel, stageLabel } from "../lib/labels.js";
import { mapError } from "../lib/errors-ui.js";
import { track } from "../lib/analytics.js";
import {
  Badge, Button, Card, EmptyState, ErrorBanner, Input, Label, Select, Skeleton, useToast,
} from "../components/ui.jsx";

interface Farm {
  id: string;
  name: string;
  district?: string;
  totalAreaBigha?: number;
  plots: { id: string; name: string; areaBigha: number; cropCycles: { id: string; cropName: string; stage: string }[] }[];
}

const CROPS = ["RICE", "WHEAT", "JUTE", "MUSTARD", "MAIZE", "POTATO"] as const;
const CROP_KEYS: Record<string, DictKey> = {
  RICE: "cropRICE", WHEAT: "cropWHEAT", JUTE: "cropJUTE",
  MUSTARD: "cropMUSTARD", MAIZE: "cropMAIZE", POTATO: "cropPOTATO",
};

export default function MyFarm() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const toast = useToast();
  const [farms, setFarms] = useState<Farm[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showFarmForm, setShowFarmForm] = useState(false);
  const [plotFor, setPlotFor] = useState<string | null>(null);
  const [cropPlotId, setCropPlotId] = useState<string | null>(null);
  const [formErrs, setFormErrs] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setFarms(await api<Farm[]>("GET", "/farms"));
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

  async function createFarm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const name = String(fd.get("name") ?? "").trim();
    const errs: Record<string, string> = {};
    if (name.length < 2) errs.name = t("errNameTooShort", lang);
    setFormErrs(errs);
    if (Object.keys(errs).length > 0) return;

    setBusy(true);
    try {
      await api("POST", "/farms", {
        name,
        district: String(fd.get("district") ?? "").trim() || undefined,
        totalAreaBigha: Number(fd.get("area")) || undefined,
      });
      track("farm_created");
      toast.success(t("farmCreatedToast", lang));
      setShowFarmForm(false);
      form.reset();
      await load();
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      setBusy(false);
    }
  }

  async function createPlot(e: React.FormEvent<HTMLFormElement>, farmId: string) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const area = Number(fd.get("area"));
    if (!fd.get("name") || !area || area <= 0) {
      toast.error(t("errFieldRequired", lang));
      return;
    }
    setBusy(true);
    try {
      await api("POST", `/farms/${farmId}/plots`, {
        name: fd.get("name"),
        areaBigha: area,
        soilType: String(fd.get("soil") ?? "").trim() || undefined,
      });
      toast.success(t("plotCreatedToast", lang));
      setPlotFor(null);
      form.reset();
      await load();
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      setBusy(false);
    }
  }

  async function createCrop(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    if (!cropPlotId || !fd.get("crop") || !fd.get("date")) {
      toast.error(t("errFieldRequired", lang));
      return;
    }
    setBusy(true);
    try {
      await api("POST", "/farms/crops", {
        plotId: cropPlotId,
        cropName: fd.get("crop"),
        plantedAt: new Date(fd.get("date") as string).toISOString(),
      });
      toast.success(t("cropCreatedToast", lang));
      setCropPlotId(null);
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-stone-800"><span aria-hidden>🚜</span> {t("myFarm", lang)}</h1>
        <Button onClick={() => setShowFarmForm((s) => !s)} aria-expanded={showFarmForm}>
          + {t("addFarm", lang)}
        </Button>
      </div>
      {loadError && (
        <div className="space-y-2">
          <ErrorBanner message={loadError} />
          <Button variant="outline" onClick={() => void load()}>{t("retry", lang)}</Button>
        </div>
      )}

      {showFarmForm && (
        <Card>
          <form onSubmit={createFarm} noValidate className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="fm-name">{t("farmNamePh", lang)}</Label>
              <Input id="fm-name" name="name" aria-invalid={Boolean(formErrs.name)} />
              {formErrs.name && <p role="alert" className="mt-1 text-xs text-red-600">{formErrs.name}</p>}
            </div>
            <div>
              <Label htmlFor="fm-district">{t("districtPh", lang)}</Label>
              <Input id="fm-district" name="district" />
            </div>
            <div>
              <Label htmlFor="fm-area">{t("areaBigha", lang)}</Label>
              <Input id="fm-area" name="area" type="number" step="0.1" min="0.1" />
            </div>
            <Button type="submit" className="sm:col-span-3" loading={busy}>{t("save", lang)}</Button>
          </form>
        </Card>
      )}

      {!loading && !loadError && farms.length === 0 && !showFarmForm && (
        <EmptyState icon="🚜" title={t("noFarmsYet", lang)} />
      )}
      {loading && !loadError && (
        <Card><Skeleton className="h-16 w-full" /></Card>
      )}

      {farms.map((farm) => (
        <Card key={farm.id} className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-stone-800">{farm.name}</h2>
              <p className="text-xs text-stone-500">
                {[farm.district, farm.totalAreaBigha !== undefined ? `${farm.totalAreaBigha} ${t("bighaShort", lang)}` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setPlotFor(plotFor === farm.id ? null : farm.id)}>
              + {t("addPlot", lang)}
            </Button>
          </div>

          {plotFor === farm.id && (
            <form onSubmit={(e) => createPlot(e, farm.id)} noValidate className="grid gap-3 rounded-lg bg-stone-50 p-3 sm:grid-cols-4">
              <div>
                <Label htmlFor={`pl-name-${farm.id}`}>{t("plotNamePh", lang)}</Label>
                <Input id={`pl-name-${farm.id}`} name="name" required />
              </div>
              <div>
                <Label htmlFor={`pl-area-${farm.id}`}>{t("areaBigha", lang)}</Label>
                <Input id={`pl-area-${farm.id}`} name="area" type="number" step="0.1" min="0.1" required />
              </div>
              <div>
                <Label htmlFor={`pl-soil-${farm.id}`}>{t("soilTypePh", lang)}</Label>
                <Input id={`pl-soil-${farm.id}`} name="soil" />
              </div>
              <div className="flex items-end">
                <Button type="submit" className="w-full" loading={busy}>{t("submit", lang)}</Button>
              </div>
            </form>
          )}

          <ul className="space-y-2">
            {farm.plots.map((plot) => (
              <li key={plot.id} className="rounded-lg border border-stone-100 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-stone-700">
                    <span aria-hidden>📍</span> {plot.name} ({plot.areaBigha} {t("bighaShort", lang)})
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCropPlotId(cropPlotId === plot.id ? null : plot.id)}
                  >
                    + {t("addCrop", lang)}
                  </Button>
                </div>
                {cropPlotId === plot.id && (
                  <form onSubmit={createCrop} noValidate className="mt-2 grid gap-2 rounded-lg bg-green-50 p-2 sm:grid-cols-3">
                    <Select name="crop" defaultValue="" required aria-label={t("cropName", lang)}>
                      <option value="" disabled>{t("cropName", lang)}</option>
                      {CROPS.map((c) => (
                        <option key={c} value={c}>{t(CROP_KEYS[c], lang)}</option>
                      ))}
                    </Select>
                    <Input name="date" type="date" required aria-label={t("plantedAtLabel", lang)} />
                    <Button type="submit" loading={busy}>{t("submit", lang)}</Button>
                  </form>
                )}
                {plot.cropCycles.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {plot.cropCycles.map((c) => (
                      <Badge key={c.id} className="bg-green-100 text-green-900">
                        <span aria-hidden>🌱</span> {cropLabel(c.cropName, lang)} · {stageLabel(c.stage, lang)}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-stone-400">{t("noPlotsYet", lang)}</p>
                )}
              </li>
            ))}
            {farm.plots.length === 0 && <li className="text-xs text-stone-400">{t("noPlotsYet", lang)}</li>}
          </ul>
        </Card>
      ))}
    </div>
  );
}
