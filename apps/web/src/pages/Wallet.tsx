import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";

interface WalletData {
  balancePaisa: number;
  transactions: { id: string; direction: string; amountPaisa: number; reason: string; createdAt: string }[];
}
interface Plan {
  tier: string;
  pricePaisa: number;
  benefits: string[];
}

export default function WalletPage() {
  const { session, refresh } = useSession();
  const lang = session?.lang ?? "bn";
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setWallet(await api<WalletData>("GET", "/wallet"));
        setPlans(await api<Plan[]>("GET", "/membership/plans"));
      } catch {
        setMsg(t("errorGeneric", lang));
      }
    })();
  }, []);

  async function buyPlan(tier: string) {
    try {
      const intent = await api<{ paymentId: string }>("POST", "/payments/intent", { purposeType: "MEMBERSHIP", purposeId: tier });
      await api("POST", `/payments/${intent.paymentId}/confirm`);
      setMsg(lang === "bn" ? `✅ ${tier} মেম্বারশিপ সক্রিয় (স্যান্ডবক্স)।` : `✅ ${tier} membership active (sandbox).`);
      await refresh();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-stone-800">👛 {t("wallet", lang)}</h1>
      {msg && <p className="card bg-green-50 text-sm text-green-800">{msg}</p>}

      <div className="card bg-gradient-to-r from-green-700 to-green-800 text-white">
        <p className="text-sm opacity-80">ব্যালেন্স</p>
        <p className="text-3xl font-bold">৳{((wallet?.balancePaisa ?? 0) / 100).toLocaleString("bn-BD")}</p>
      </div>

      <section>
        <h2 className="mb-2 font-semibold text-stone-700">🎖️ {t("membership", lang)}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {plans.map((p) => (
            <div key={p.tier} className={`card ${p.tier === "GOLD" ? "border-amber-300" : p.tier === "SILVER" ? "border-stone-300" : ""}`}>
              <h3 className="font-bold text-stone-800">{p.tier}</h3>
              <p className="my-1 text-xl font-bold text-green-800">
                {p.pricePaisa === 0 ? "ফ্রি" : `৳${(p.pricePaisa / 100).toLocaleString("bn-BD")}`}
              </p>
              <ul className="mb-3 space-y-1 text-xs text-stone-500">
                {p.benefits.map((b, i) => <li key={i}>✓ {b}</li>)}
              </ul>
              {p.pricePaisa > 0 && (
                <button className="btn-outline w-full !py-2" onClick={() => buyPlan(p.tier)}>
                  {t("payNow", lang)}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-2 font-semibold text-stone-700">{lang === "bn" ? "লেনদেন" : "Transactions"}</h2>
        <div className="card divide-y divide-stone-100 !p-0">
          {(wallet?.transactions ?? []).length === 0 && (
            <p className="p-4 text-center text-sm text-stone-400">{lang === "bn" ? "কোনো লেনদেন নেই।" : "No transactions yet."}</p>
          )}
          {(wallet?.transactions ?? []).map((tx) => (
            <div key={tx.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <p className="font-medium text-stone-700">{tx.reason}</p>
                <p className="text-[11px] text-stone-400">{new Date(tx.createdAt).toLocaleString(lang === "bn" ? "bn-BD" : "en-US")}</p>
              </div>
              <span className={`font-bold ${tx.direction === "CREDIT" ? "text-green-700" : "text-red-600"}`}>
                {tx.direction === "CREDIT" ? "+" : "−"}৳{(tx.amountPaisa / 100).toFixed(0)}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
