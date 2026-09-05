import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";
import { formatBDT, formatDateTime, takaToPaisa } from "../lib/format.js";
import { channelLabel, paymentPurposeLabel, reasonLabel, withdrawalStatusLabel } from "../lib/labels.js";
import { mapError } from "../lib/errors-ui.js";
import { track } from "../lib/analytics.js";
import { Award, Check, Landmark, Receipt, Wallet } from "lucide-react";
import {
  Badge, Button, Card, EmptyState, ErrorBanner, Input, Label, Modal, Select, Skeleton, useConfirm, useToast,
} from "../components/ui.jsx";

interface Tx {
  id: string;
  direction: string;
  amountPaisa: number;
  reason: string;
  createdAt: string;
}
interface WalletData {
  balancePaisa: number;
  transactions: Tx[];
}
interface WalletSummary {
  monthCreditsPaisa: number;
  monthDebitsPaisa: number;
  pendingWithdrawalsPaisa: number;
  membership?: { tier: string; expiresAt: string | null; discountPct: number };
}
interface Withdrawal {
  id: string;
  refNo: string;
  amountPaisa: number;
  status: string;
  channel: string;
  destination?: string | null;
  createdAt: string;
}
interface PaymentRecord {
  id: string;
  refNo: string;
  purposeType: string;
  amountPaisa: number;
  method: string;
  status: string; // PENDING|SUCCEEDED|FAILED|REFUNDED
  createdAt: string;
}
interface Plan {
  tier: string;
  pricePaisa: number;
  benefits: string[];
}

const MIN_WITHDRAWAL_PAISA = 10_000; // mirrors API rule
const CHANNELS = ["BKASH", "NAGAD", "BANK"] as const;

export default function WalletPage() {
  const { session, refresh } = useSession();
  const lang = session?.lang ?? "bn";
  const toast = useToast();
  const confirm = useConfirm();

  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [summary, setSummary] = useState<WalletSummary | null>(null);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // Withdraw dialog
  const [wdOpen, setWdOpen] = useState(false);
  const [wdAmount, setWdAmount] = useState("");
  const [wdChannel, setWdChannel] = useState<(typeof CHANNELS)[number]>("BKASH");
  const [wdErr, setWdErr] = useState("");
  const [wdBusy, setWdBusy] = useState(false);
  const [planBusyTier, setPlanBusyTier] = useState<string | null>(null);

  async function load() {
    setLoadError(false);
    setLoading(true);
    try {
      const [w, s, wd, p, pay] = await Promise.all([
        api<WalletData>("GET", "/wallet"),
        api<WalletSummary>("GET", "/wallet/summary"),
        api<Withdrawal[]>("GET", "/wallet/withdrawals"),
        api<Plan[]>("GET", "/membership/plans"),
        api<PaymentRecord[]>("GET", "/payments"),
      ]);
      setWallet(w);
      setSummary(s);
      setWithdrawals(wd);
      setPlans(p);
      setPayments(pay);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function reloadBalances() {
    try {
      const [w, s, wd, pay] = await Promise.all([
        api<WalletData>("GET", "/wallet"),
        api<WalletSummary>("GET", "/wallet/summary"),
        api<Withdrawal[]>("GET", "/wallet/withdrawals"),
        api<PaymentRecord[]>("GET", "/payments"),
      ]);
      setWallet(w);
      setSummary(s);
      setWithdrawals(wd);
      setPayments(pay);
    } catch (err) {
      toast.error(mapError(err, lang));
    }
  }

  async function buyPlan(tier: string) {
    const plan = plans.find((p) => p.tier === tier);
    const okToBuy = await confirm({
      title: t("membershipConfirmTitle", lang),
      body: t("membershipConfirmBody", lang, {
        tier,
        price: plan ? formatBDT(plan.pricePaisa, lang) : "—",
      }),
      confirmLabel: t("payNow", lang),
      cancelLabel: t("cancel", lang),
    });
    if (!okToBuy) return;
    setPlanBusyTier(tier);
    try {
      const intent = await api<{ paymentId: string; providerMode: string }>("POST", "/payments/intent", {
        purposeType: "MEMBERSHIP",
        purposeId: tier,
      });
      if (intent.providerMode === "sandbox") {
        await api("POST", `/payments/${intent.paymentId}/confirm`);
      }
      toast.success(t("membershipActiveToast", lang, { tier }));
      await Promise.all([refresh(), reloadBalances()]);
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      setPlanBusyTier(null);
    }
  }

  const availablePaisa = wallet
    ? wallet.balancePaisa - (summary?.pendingWithdrawalsPaisa ?? 0)
    : null;

  function submitWithdraw(e: React.FormEvent) {
    e.preventDefault();
    const taka = Number(wdAmount);
    const paisa = takaToPaisa(taka);
    if (!wdAmount || Number.isNaN(taka) || paisa < MIN_WITHDRAWAL_PAISA) {
      setWdErr(t("errAmountInvalid", lang));
      return;
    }
    if (availablePaisa !== null && paisa > availablePaisa) {
      setWdErr(t("errInsufficientBalance", lang));
      return;
    }
    setWdErr("");
    void doWithdraw(paisa);
  }

  async function doWithdraw(amountPaisa: number) {
    setWdBusy(true);
    try {
      await api("POST", "/wallet/withdrawals", { amountPaisa, channel: wdChannel });
      track("withdrawal_requested", { channel: wdChannel });
      toast.success(t("withdrawRequestedToast", lang));
      setWdOpen(false);
      setWdAmount("");
      await reloadBalances();
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      setWdBusy(false);
    }
  }

  return (
    <div className="min-w-0 space-y-6 overflow-hidden px-2 sm:px-0">
      <h1 className="flex items-center gap-2 text-xl font-bold text-stone-800"><Wallet className="h-6 w-6 text-green-700" aria-hidden /> {t("wallet", lang)}</h1>

      {loadError && (
        <div className="space-y-2">
          <ErrorBanner message={t("errorGeneric", lang)} />
          <Button variant="outline" onClick={() => void load()}>{t("retry", lang)}</Button>
        </div>
      )}

      {/* Summary cards row */}
      <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
        <Card className="min-w-0 overflow-hidden bg-gradient-to-r from-green-700 to-green-800 text-white">
          <p className="text-xs opacity-80">{t("balance", lang)}</p>
          <div aria-live="polite" aria-atomic="true">
            {wallet ? (
              <p className="mt-0.5 text-2xl font-bold">{formatBDT(wallet.balancePaisa, lang)}</p>
            ) : loading ? (
              <Skeleton className="mt-1 h-8 w-28" />
            ) : (
              <p className="mt-0.5 text-2xl font-bold">—</p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 border-white/60 text-white hover:bg-white/10"
            disabled={!wallet}
            onClick={() => setWdOpen(true)}
          >
            {t("withdrawTitle", lang)}
          </Button>
        </Card>
        <Card className="min-w-0 overflow-hidden">
          <p className="text-[11px] font-medium uppercase tracking-wide text-stone-500">{t("monthIn", lang)}</p>
          {summary ? (
            <p className="mt-0.5 text-lg font-bold text-green-800">{formatBDT(summary.monthCreditsPaisa, lang)}</p>
          ) : (
            <Skeleton className="mt-1 h-6 w-20" />
          )}
        </Card>
        <Card className="min-w-0 overflow-hidden">
          <p className="text-[11px] font-medium uppercase tracking-wide text-stone-500">{t("monthOut", lang)}</p>
          {summary ? (
            <p className="mt-0.5 text-lg font-bold text-red-600">{formatBDT(summary.monthDebitsPaisa, lang)}</p>
          ) : (
            <Skeleton className="mt-1 h-6 w-20" />
          )}
        </Card>
        <Card className="min-w-0 overflow-hidden">
          <p className="text-[11px] font-medium uppercase tracking-wide text-stone-500">{t("pendingWithdrawals", lang)}</p>
          {summary ? (
            <p className="mt-0.5 text-lg font-bold text-stone-700">{formatBDT(summary.pendingWithdrawalsPaisa, lang)}<span className="sr-only"> pending withdrawals</span></p>
          ) : (
            <Skeleton className="mt-1 h-6 w-20" />
          )}
        </Card>
      </div>

      {/* Membership */}
      <section>
        <h2 className="mb-2 flex items-center gap-2 font-semibold text-stone-700"><Award className="h-5 w-5 text-amber-600" aria-hidden /> {t("membership", lang)}</h2>
        <div className="grid gap-2 sm:gap-4 sm:grid-cols-3">
          {plans.map((p) => (
            <Card key={p.tier} className={`min-w-0 overflow-hidden ${p.tier === "GOLD" ? "border-amber-300" : p.tier === "SILVER" ? "border-stone-300" : ""}`}>
              <h3 className="font-bold text-stone-800">{p.tier}</h3>
              <p className="my-1 text-xl font-bold text-green-800">
                {p.pricePaisa === 0 ? t("freeLabel", lang) : formatBDT(p.pricePaisa, lang)}
              </p>
              <ul className="mb-3 space-y-1 text-xs text-stone-600">
                {p.benefits.map((b, i) => {
                  const benefitMap: Record<string, { bn: string; en: string }> = {
                    "Basic AI advisory": { bn: "বেসিক এআই পরামর্শ", en: "Basic AI advisory" },
                    "Weekly weather digest": { bn: "সাপ্তাহিক আবহাওয়া সারাংশ", en: "Weekly weather digest" },
                    "Unlimited AI advisory": { bn: "আনলিমিটেড এআই পরামর্শ", en: "Unlimited AI advisory" },
                    "3% marketplace discount": { bn: "বাজারে ৩% ছাড়", en: "3% marketplace discount" },
                    "5% marketplace discount": { bn: "বাজারে ৫% ছাড়", en: "5% marketplace discount" },
                    "Priority soil testing": { bn: "অগ্রাধিকার মাটি পরীক্ষা", en: "Priority soil testing" },
                    "Free drone spraying per season": { bn: "প্রতি মৌসুমে বিনামূল্যে ড্রোন স্প্রে", en: "Free drone spraying per season" },
                    "Dedicated agronomist hotline": { bn: "নিবেদিত কৃষিবিদ হটলাইন", en: "Dedicated agronomist hotline" },
                  };
                  const label = benefitMap[b] ? (lang === "bn" ? benefitMap[b].bn : benefitMap[b].en) : b;
                  return <li key={i} className="flex items-center gap-1"><Check className="h-3 w-3 text-green-600" aria-hidden /> {label}</li>;
                })}
              </ul>
              {summary?.membership?.tier === p.tier && summary.membership.expiresAt && (() => {
                const daysLeft = Math.ceil((new Date(summary.membership!.expiresAt!).getTime() - Date.now()) / 86400000);
                if (daysLeft <= 7 && daysLeft >= 0) return <Badge className="mb-2 bg-amber-100 text-amber-800">{lang === "bn" ? `মেয়াদ শেষ ${daysLeft} দিনে` : `Expires in ${daysLeft}d`}</Badge>;
                if (daysLeft < 0) return <Badge className="mb-2 bg-red-100 text-red-700">{t("membershipExpired", lang)}</Badge>;
                return null;
              })()}
              {p.pricePaisa > 0 && (
                <Button variant="outline" className="w-full" loading={planBusyTier === p.tier} onClick={() => void buyPlan(p.tier)}>
                  {t("payNow", lang)}
                </Button>
              )}
            </Card>
          ))}
        </div>
      </section>

      {/* Transactions — wallet ledger merged with payment records (orders/bookings
          paid outside the wallet balance; WALLET_CREDIT skipped to avoid double rows) */}
      <section>
        <h2 className="mb-2 font-semibold text-stone-700">{t("transactionsTitle", lang)}</h2>
        {!wallet && loading ? (
          <Card className="space-y-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </Card>
        ) : (() => {
          const txnRows = (wallet?.transactions ?? []).map((tx) => ({
            id: tx.id,
            label: reasonLabel(tx.reason, lang),
            ref: tx.id,
            amountPaisa: tx.amountPaisa,
            credit: tx.direction === "CREDIT",
            createdAt: tx.createdAt,
          }));
          const paymentRows = payments
            .filter((p) => (p.status === "SUCCEEDED" || p.status === "REFUNDED") && p.method !== "WALLET_CREDIT")
            .map((p) => ({
              id: p.id,
              label: p.status === "REFUNDED"
                ? `${paymentPurposeLabel(p.purposeType, lang)} · ${t("walletREFUND", lang)}`
                : paymentPurposeLabel(p.purposeType, lang),
              ref: p.refNo,
              amountPaisa: p.amountPaisa,
              credit: p.status === "REFUNDED",
              createdAt: p.createdAt,
            }));
          const rows = [...txnRows, ...paymentRows].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
          return rows.length === 0 ? (
            <EmptyState icon={<Receipt className="h-10 w-10 text-stone-300" aria-hidden />} title={t("noTransactions", lang)} />
          ) : (
            <Card className="divide-y divide-stone-100 !p-0">
              {rows.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="break-words font-medium text-stone-700 [overflow-wrap:anywhere]">{row.label}</p>
                    <p className="break-words text-[11px] text-stone-500 [overflow-wrap:anywhere]">{formatDateTime(row.createdAt, lang)}</p>
                    <p className="break-all text-[10px] font-mono text-stone-400 [overflow-wrap:anywhere]">{row.ref}</p>
                  </div>
                  <span className={`font-bold ${row.credit ? "text-green-700" : "text-red-600"}`}>
                    {row.credit ? "+" : "−"}{formatBDT(row.amountPaisa, lang)}
                  </span>
                </div>
              ))}
            </Card>
          );
        })()}
      </section>

      {/* Withdrawal history */}
      <section>
        <h2 className="mb-2 font-semibold text-stone-700">{t("withdrawHistory", lang)}</h2>
        {!wallet && loading ? (
          <Card className="space-y-2">
            {[0, 1].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </Card>
        ) : withdrawals.length === 0 ? (
          <EmptyState icon={<Landmark className="h-10 w-10 text-stone-300" aria-hidden />} title={t("noWithdrawalsYet", lang)} />
        ) : (
          <Card className="divide-y divide-stone-100 !p-0">
            {withdrawals.map((wd) => (
              <div key={wd.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="break-words font-bold text-stone-700 [overflow-wrap:anywhere]">{formatBDT(wd.amountPaisa, lang)} · {channelLabel(wd.channel, lang)}</p>
                  <p className="break-all text-[11px] text-stone-500 [overflow-wrap:anywhere]">
                    {wd.refNo}{wd.destination ? ` · ${t("destinationLabel", lang)}: ${wd.destination}` : ""} · {formatDateTime(wd.createdAt, lang)}
                  </p>
                  <p className="break-all text-[10px] font-mono text-stone-400 [overflow-wrap:anywhere]">{wd.id}</p>
                </div>
                <Badge
                  className={
                    wd.status === "PAID"
                      ? "bg-green-100 text-green-900"
                      : wd.status === "REJECTED"
                        ? "bg-red-100 text-red-700"
                        : "bg-amber-100 text-amber-900"
                  }
                >
                  {withdrawalStatusLabel(wd.status, lang)}
                </Badge>
              </div>
            ))}
          </Card>
        )}
      </section>

      {/* Withdraw dialog */}
      {wdOpen && (
        <Modal title={t("withdrawTitle", lang)} onClose={() => !wdBusy && setWdOpen(false)}>
          <form onSubmit={submitWithdraw} noValidate className="space-y-3">
            <div>
              <Label htmlFor="wd-amount">{t("withdrawAmountLabel", lang)}</Label>
              <Input
                id="wd-amount"
                type="number"
                inputMode="decimal"
                min="100"
                step="0.01"
                value={wdAmount}
                onChange={(e) => { setWdAmount(e.target.value); if (wdErr) setWdErr(""); }}
                onBlur={() => { const taka = Number(wdAmount); if (wdAmount && (Number.isNaN(taka) || takaToPaisa(taka) < MIN_WITHDRAWAL_PAISA)) setWdErr(t("errAmountInvalid", lang)); }}
                aria-invalid={Boolean(wdErr)}
                aria-describedby={wdErr ? "wd-amount-err" : undefined}
              />
              <p className="mt-1 text-[11px] text-stone-500">
                {t("withdrawMinNote", lang)}
                {availablePaisa !== null && ` · ${t("withdrawAvailable", lang)}: ${formatBDT(availablePaisa, lang)}`}
              </p>
            </div>
            <div>
              <Label htmlFor="wd-channel">{t("withdrawMethodLabel", lang)}</Label>
              <Select id="wd-channel" value={wdChannel} onChange={(e) => setWdChannel(e.target.value as (typeof CHANNELS)[number])}>
                {CHANNELS.map((ch) => (
                  <option key={ch} value={ch}>{t(`withdrawMethod${ch}`, lang)}</option>
                ))}
              </Select>
            </div>
            {wdErr && <div id="wd-amount-err" role="alert"><ErrorBanner message={wdErr} /></div>}
            <div className="flex gap-2 pt-1">
              <Button type="button" variant="ghost" className="flex-1" disabled={wdBusy} onClick={() => setWdOpen(false)}>
                {t("cancel", lang)}
              </Button>
              <Button type="submit" className="flex-[2]" loading={wdBusy}>{t("withdrawRequestBtn", lang)}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
