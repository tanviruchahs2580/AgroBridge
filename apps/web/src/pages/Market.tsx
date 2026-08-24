import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";

interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  pricePaisa: number;
  stockQty: number;
}
interface CartItem {
  id: string;
  qty: number;
  product: { id: string; name: string; pricePaisa: number };
}

const CATEGORIES = [
  { key: "", bn: "সব", en: "All" },
  { key: "SEED", bn: "বীজ", en: "Seeds" },
  { key: "FERTILIZER", bn: "সার", en: "Fertilizer" },
  { key: "BIO_INPUT", bn: "জৈব", en: "Bio-inputs" },
  { key: "CROP_PROTECTION", bn: "কীটনাশক", en: "Crop protection" },
  { key: "EQUIPMENT", bn: "যন্ত্রপাতি", en: "Equipment" },
];

export default function Market() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const [products, setProducts] = useState<Product[]>([]);
  const [category, setCategory] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  async function load(cat = category) {
    const data = await api<{ items: Product[] }>("GET", `/products?pageSize=50${cat ? `&category=${cat}` : ""}`);
    setProducts(data.items);
    setCart((await api<{ items: CartItem[] }>("GET", "/cart")).items);
  }

  useEffect(() => {
    void load(category).catch(() => setMsg(t("errorGeneric", lang)));
  }, [category]);

  async function add(p: Product) {
    try {
      await api("POST", "/cart/items", { productId: p.id, qty: 1 });
      await load();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  async function checkout() {
    setBusy(true);
    setMsg("");
    try {
      await api("POST", "/orders/checkout");
      await load();
      setMsg(lang === "bn" ? "✅ অর্ডার নিশ্চিত হয়েছে — Notifications-এ দেখুন।" : "✅ Order confirmed — see Notifications.");
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const subtotalPaisa = cart.reduce((s, i) => s + i.product.pricePaisa * i.qty, 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-stone-800">🛒 {t("market", lang)}</h1>
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.key || "all"}
            onClick={() => setCategory(c.key)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${category === c.key ? "bg-green-700 text-white" : "bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-green-50"}`}
          >
            {lang === "bn" ? c.bn : c.en}
          </button>
        ))}
      </div>
      {msg && <p className="card bg-green-50 text-sm text-green-800">{msg}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((p) => (
          <div key={p.id} className="card flex flex-col justify-between">
            <div>
              <div className="mb-1 flex items-start justify-between gap-2">
                <h3 className="text-sm font-bold leading-snug text-stone-800">{p.name}</h3>
                <span className="badge shrink-0 bg-stone-100 text-stone-500">{p.category}</span>
              </div>
              <p className="text-lg font-bold text-green-800">৳{(p.pricePaisa / 100).toLocaleString("bn-BD")} <span className="text-xs font-normal text-stone-400">/ {p.unit}</span></p>
              <p className="mt-0.5 text-[11px] text-stone-400">{p.stockQty > 0 ? `স্টক: ${p.stockQty}` : "স্টক নেই"}</p>
            </div>
            <button className="btn-primary mt-3 w-full !py-2" disabled={p.stockQty === 0} onClick={() => add(p)}>+ {t("cart", lang)}</button>
          </div>
        ))}
      </div>

      {cart.length > 0 && (
        <div className="card sticky bottom-4 space-y-2 border-green-200 ring-1 ring-green-100">
          <h3 className="font-semibold text-stone-700">🧺 {t("cart", lang)} ({cart.length})</h3>
          <ul className="space-y-1 text-sm">
            {cart.map((i) => (
              <li key={i.id} className="flex justify-between text-stone-600">
                <span>{i.product.name} × {i.qty}</span>
                <span>৳{((i.product.pricePaisa * i.qty) / 100).toFixed(0)}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between border-t border-stone-100 pt-2 font-bold text-stone-800">
            <span>মোট</span><span>৳{(subtotalPaisa / 100).toFixed(0)}</span>
          </div>
          <button className="btn-primary w-full" onClick={checkout} disabled={busy}>{t("checkout", lang)} →</button>
        </div>
      )}
    </div>
  );
}
