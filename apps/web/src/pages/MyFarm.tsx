import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";

interface Farm {
  id: string;
  name: string;
  district?: string;
  totalAreaBigha?: number;
  plots: { id: string; name: string; areaBigha: number; cropCycles: { id: string; cropName: string; stage: string }[] }[];
}

export default function MyFarm() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const [farms, setFarms] = useState<Farm[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [showFarmForm, setShowFarmForm] = useState(false);
  const [plotFor, setPlotFor] = useState<string | null>(null);
  const [cropPlotId, setCropPlotId] = useState<string | null>(null);

  async function load() {
    setFarms(await api<Farm[]>("GET", "/farms"));
  }
  useEffect(() => {
    void load().catch(() => setMsg(t("errorGeneric", lang)));
  }, []);

  async function createFarm(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api("POST", "/farms", {
        name: fd.get("name"),
        district: fd.get("district") || undefined,
        totalAreaBigha: Number(fd.get("area")) || undefined,
      });
      setShowFarmForm(false);
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createPlot(e: React.FormEvent<HTMLFormElement>, farmId: string) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api("POST", `/farms/${farmId}/plots`, {
        name: fd.get("name"),
        areaBigha: Number(fd.get("area")),
        soilType: fd.get("soil") || undefined,
      });
      setPlotFor(null);
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createCrop(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await api("POST", "/farms/crops", {
        plotId: cropPlotId,
        cropName: fd.get("crop"),
        plantedAt: new Date(fd.get("date") as string).toISOString(),
      });
      setCropPlotId(null);
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-stone-800">🚜 {t("myFarm", lang)}</h1>
        <button className="btn-primary" onClick={() => setShowFarmForm((s) => !s)}>+ {t("addFarm", lang)}</button>
      </div>
      {msg && <p className="card bg-red-50 text-sm text-red-700">{msg}</p>}

      {showFarmForm && (
        <form onSubmit={createFarm} className="card grid gap-3 sm:grid-cols-3">
          <input name="name" className="input" placeholder={lang === "bn" ? "ফার্মের নাম" : "Farm name"} required minLength={2} />
          <input name="district" className="input" placeholder="জেলা" />
          <div className="flex gap-2">
            <input name="area" type="number" step="0.1" min="0.1" className="input" placeholder="বিঘা" />
            <button className="btn-primary shrink-0" disabled={busy}>✓</button>
          </div>
        </form>
      )}

      {farms.length === 0 && !showFarmForm && (
        <p className="card text-center text-sm text-stone-400">কোনো ফার্ম নেই — উপরের বোতাম থেকে যোগ করুন।</p>
      )}

      {farms.map((farm) => (
        <div key={farm.id} className="card space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-bold text-stone-800">{farm.name}</h2>
              <p className="text-xs text-stone-500">{farm.district} · {farm.totalAreaBigha ?? "?"} বিঘা</p>
            </div>
            <button className="btn-outline !py-1.5 !text-xs" onClick={() => setPlotFor(plotFor === farm.id ? null : farm.id)}>
              + {t("addPlot", lang)}
            </button>
          </div>

          {plotFor === farm.id && (
            <form onSubmit={(e) => createPlot(e, farm.id)} className="grid gap-3 rounded-lg bg-stone-50 p-3 sm:grid-cols-4">
              <input name="name" className="input" placeholder="প্লটের নাম" required />
              <input name="area" type="number" step="0.1" min="0.1" className="input" placeholder="বিঘা" required />
              <input name="soil" className="input" placeholder="মাটির ধরন" />
              <button className="btn-primary" disabled={busy}>{t("submit", lang)}</button>
            </form>
          )}

          <ul className="space-y-2">
            {farm.plots.map((plot) => (
              <li key={plot.id} className="rounded-lg border border-stone-100 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-stone-700">📍 {plot.name} ({plot.areaBigha} বিঘা)</span>
                  <button
                    className="btn-outline !px-2 !py-1 !text-xs"
                    onClick={() => setCropPlotId(cropPlotId === plot.id ? null : plot.id)}
                  >
                    + {t("addCrop", lang)}
                  </button>
                </div>
                {cropPlotId === plot.id && (
                  <form onSubmit={createCrop} className="mt-2 grid gap-2 rounded-lg bg-green-50 p-2 sm:grid-cols-3">
                    <select name="crop" className="input" required defaultValue="">
                      <option value="" disabled>{t("cropName", lang)}</option>
                      <option value="ধান">ধান</option>
                      <option value="গম">গম</option>
                      <option value="পাট">পাট</option>
                      <option value="সরিষা">সরিষা</option>
                      <option value="ভুট্টা">ভুট্টা</option>
                      <option value="আলু">আলু</option>
                    </select>
                    <input name="date" type="date" className="input" required />
                    <button className="btn-primary" disabled={busy}>{t("submit", lang)}</button>
                  </form>
                )}
                {plot.cropCycles.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {plot.cropCycles.map((c) => (
                      <span key={c.id} className="badge bg-green-100 text-green-900">
                        🌱 {c.cropName} · {c.stage}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
            {farm.plots.length === 0 && <li className="text-xs text-stone-400">এখনো প্লট যোগ করা হয়নি।</li>}
          </ul>
        </div>
      ))}
    </div>
  );
}
