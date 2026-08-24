import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";

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

export default function Services() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const [services, setServices] = useState<Service[]>([]);
  const [farms, setFarms] = useState<{ id: string; name: string }[]>([]);
  const [selected, setSelected] = useState<Service | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setServices(await api<Service[]>("GET", "/services"));
        setFarms(await api<{ id: string; name: string }[]>("GET", "/farms"));
      } catch {
        setMsg(t("errorGeneric", lang));
      }
    })();
  }, []);

  async function book(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setMsg("");
    try {
      await api("POST", "/bookings", {
        farmId: fd.get("farm"),
        serviceId: selected.id,
        providerId: fd.get("provider") || undefined,
        scheduledFor: new Date(fd.get("date") as string).toISOString(),
        areaBigha: Number(fd.get("area")),
      });
      setSelected(null);
      setMsg(lang === "bn" ? "✅ বুকিং গৃহীত হয়েছে!" : "✅ Booking received!");
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-stone-800">🚜 {t("services", lang)}</h1>
      {msg && <p className="card bg-green-50 text-sm text-green-800">{msg}</p>}
      {farms.length === 0 && (
        <p className="card bg-amber-50 text-sm text-amber-800">
          বুকিং দিতে আগে <b>{t("myFarm", lang)}</b>-এ ফার্ম যোগ করুন।
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {services.map((s) => (
          <div key={s.id} className="card flex items-center justify-between">
            <div>
              <h3 className="font-bold text-stone-800">{s.name}</h3>
              <p className="text-xs text-stone-400">{s.category}</p>
              <p className="mt-1 text-sm font-semibold text-green-800">
                ৳{(s.basePricePaisa / 100).toLocaleString("bn-BD")} <span className="text-[10px] font-normal text-stone-400">{s.priceUnit.replace("PER_", "/ ")}</span>
              </p>
            </div>
            <button className="btn-primary !py-2" onClick={() => setSelected(s)} disabled={farms.length === 0}>
              {t("bookNow", lang)}
            </button>
          </div>
        ))}
      </div>

      {selected && (
        <form onSubmit={book} className="card space-y-3 border-green-300">
          <h3 className="font-bold text-green-900">{selected.name} — {t("bookNow", lang)}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <select name="farm" className="input" required defaultValue="">
              <option value="" disabled>ফার্ম</option>
              {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <input name="date" type="datetime-local" className="input" required min={new Date().toISOString().slice(0, 16)} />
            <input name="area" type="number" step="0.1" min="0.1" className="input" placeholder={t("areaBigha", lang)} required />
            <select name="provider" className="input" defaultValue="">
              <option value="">সেবাদাতা (পরে নিয়োগ)</option>
              {selected.providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.district ? ` · ${p.district}` : ""}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-outline flex-1" onClick={() => setSelected(null)}>✕</button>
            <button className="btn-primary flex-[2]" disabled={busy}>{t("submit", lang)}</button>
          </div>
        </form>
      )}
    </div>
  );
}
