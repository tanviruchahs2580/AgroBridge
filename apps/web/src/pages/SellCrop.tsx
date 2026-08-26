import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";

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
// F-UX3: farmer-first bilingual labels (value stays API enum)
const CROP_LABELS: Record<string, string> = { RICE: "ধান (RICE)", WHEAT: "গম (WHEAT)", JUTE: "পাট (JUTE)", MUSTARD: "সরিষা (MUSTARD)", MAIZE: "ভুট্টা (MAIZE)", POTATO: "আলু (POTATO)" };

export default function SellCrop() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const [farms, setFarms] = useState<{ id: string; name: string }[]>([]);
  const [orders, setOrders] = useState<ProcurementOrder[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setOrders(await api<ProcurementOrder[]>("GET", "/procurement"));
  }

  useEffect(() => {
    (async () => {
      try {
        setFarms(await api<{ id: string; name: string }[]>("GET", "/farms"));
        await load();
      } catch {
        setMsg(t("errorGeneric", lang));
      }
    })();
  }, []);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setMsg("");
    try {
      await api("POST", "/procurement/offers", {
        farmId: fd.get("farm"),
        cropName: fd.get("crop"),
        quantityKg: Number(fd.get("qty")),
        moisturePct: fd.get("moisture") ? Number(fd.get("moisture")) : undefined,
        qualityGrade: fd.get("grade"),
      });
      await load();
      setMsg(lang === "bn" ? "✅ অফার জমা হয়েছে — গুণগত যাচাইয়ের অপেক্ষায়।" : "✅ Offer submitted — pending QC.");
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-stone-800">💰 {t("sellCrop", lang)}</h1>
      {msg && <p className="card bg-green-50 text-sm text-green-800">{msg}</p>}

      <form onSubmit={submit} className="card grid gap-3 sm:grid-cols-2">
        <select name="farm" className="input" required defaultValue="">
          <option value="" disabled>ফার্ম</option>
          {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select name="crop" className="input" required defaultValue="">
          <option value="" disabled>{t("cropName", lang)}</option>
          {CROPS.map((c) => <option key={c} value={c}>{CROP_LABELS[c] ?? c}</option>)}
        </select>
        <input name="qty" type="number" min="1" step="1" className="input" placeholder={t("quantityKg", lang)} required />
        <div className="grid grid-cols-2 gap-3">
          <input name="moisture" type="number" min="0" max="60" step="0.5" className="input" placeholder={t("moisturePct", lang)} />
          <select name="grade" className="input" defaultValue="A" title={t("qualityGrade", lang)}>
            <option value="A">গ্রেড A</option>
            <option value="B">গ্রেড B</option>
            <option value="C">গ্রেড C</option>
          </select>
        </div>
        <button className="btn-primary sm:col-span-2" disabled={busy || farms.length === 0}>{t("submit", lang)}</button>
      </form>

      <h2 className="pt-2 font-semibold text-stone-700">{lang === "bn" ? "আমার ফসলের অফার" : "My offers"}</h2>
      <div className="space-y-2">
        {orders.length === 0 && <p className="card text-center text-sm text-stone-400">এখনো কোনো অফার নেই।</p>}
        {orders.map((o) => (
          <div key={o.id} className="card flex items-center justify-between text-sm">
            <div>
              <span className="font-bold text-stone-800">{o.cropName}</span> · {o.quantityKg} কেজি · গ্রেড {o.qualityGrade}
              <p className="text-xs text-stone-400">{o.poNo}</p>
            </div>
            <div className="text-right">
              <p className="font-bold text-green-800">৳{(o.netPayablePaisa / 100).toLocaleString("bn-BD")}</p>
              <span className="badge bg-stone-100 text-stone-600">{o.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
