import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";
import { formatBDT, formatDateTime, takaToPaisa } from "../lib/format.js";
import { channelLabel, reasonLabel, withdrawalStatusLabel } from "../lib/labels.js";
import { mapError } from "../lib/errors-ui.js";
import { track } from "../lib/analytics.js";
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
      const [w, s, wd, p] = await Promise.all([
        api<WalletData>("GET", "/wallet"),
        api<WalletSummary>("GET", "/wallet/summary"),
        api<Withdrawal[]>("GET", "/wallet/withdrawals"),
        api<Plan[]>("GET", "/membership/plans"),
      ]);
      setWallet(w);
      setSummary(s);
      setWithdrawals(wd);
      setPlans(p);
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
      const [w, s, wd] = await Promise.all([
        api<WalletData>("GET", "/wallet"),
        api<WalletSummary>("GET", "/wallet/summary"),
        api<Withdrawal[]>("GET", "/wallet/withdrawals"),
      ]);
      setWallet(w);
      setSummary(s);
      setWithdrawals(wd);
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
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-stone-800"><span aria-hidden>👛</span> {t("wallet", lang)}</h1>

      {loadError && (
        <div className="space-y-2">
          <ErrorBanner message={t("errorGeneric", lang)} />
          <Button variant="outline" onClick={() => void load()}>{t("retry", lang)}</Button>
        </div>
      )}

      {/* Summary cards row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card className="bg-gradient-to-r from-green-700 to-green-800 text-white">
          <p className="text-xs opacity-80">{t("balance", lang)}</p>
          {wallet ? (
            <p className="mt-0.5 text-2xl font-bold">{formatBDT(wallet.balancePaisa, lang)}</p>
          ) : loading ? (
            <Skeleton className="mt-1 h-8 w-28" />
          ) : (
            <p className="mt-0.5 text-2xl font-bold">—</p>
          )}
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
        <Card>
          <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">{t("monthIn", lang)}</p>
          {summary ? (
            <p className="mt-0.5 text-lg font-bold text-green-800">{formatBDT(summary.monthCreditsPaisa, lang)}</p>
          ) : (
            <Skeleton className="mt-1 h-6 w-20" />
          )}
        </Card>
        <Card>
          <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">{t("monthOut", lang)}</p>
          {summary ? (
            <p className="mt-0.5 text-lg font-bold text-red-600">{formatBDT(summary.monthDebitsPaisa, lang)}</p>
          ) : (
            <Skeleton className="mt-1 h-6 w-20" />
          )}
        </Card>
        <Card>
          <p className="text-[11px] font-medium uppercase tracking-wide text-stone-400">{t("pendingWithdrawals", lang)}</p>
          {summary ? (
            <p className="mt-0.5 text-lg font-bold text-stone-700">{formatBDT(summary.pendingWithdrawalsPaisa, lang)}</p>
          ) : (
            <Skeleton className="mt-1 h-6 w-20" />
          )}
        </Card>
      </div>

      {/* Membership */}
      <section>
        <h2 className="mb-2 font-semibold text-stone-700"><span aria-hidden>🎖️</span> {t("membership", lang)}</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {plans.map((p) => (
            <Card key={p.tier} className={p.tier === "GOLD" ? "border-amber-300" : p.tier === "SILVER" ? "border-stone-300" : ""}>
              <h3 className="font-bold text-stone-800">{p.tier}</h3>
              <p className="my-1 text-xl font-bold text-green-800">
                {p.pricePaisa === 0 ? t("freeLabel", lang) : formatBDT(p.pricePaisa, lang)}
              </p>
              <ul className="mb-3 space-y-1 text-xs text-stone-500">
                {p.benefits.map((b, i) => (
                  <li key={i}><span aria-hidden>✓</span> {b}</li>
                ))}
              </ul>
              {p.pricePaisa > 0 && (
                <Button variant="outline" className="w-full" loading={planBusyTier === p.tier} onClick={() => void buyPlan(p.tier)}>
                  {t("payNow", lang)}
                </Button>
              )}
            </Card>
          ))}
        </div>
      </section>

      {/* Transactions */}
      <section>
        <h2 className="mb-2 font-semibold text-stone-700">{t("transactionsTitle", lang)}</h2>
        {!wallet && loading ? (
          <Card className="space-y-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </Card>
        ) : (wallet?.transactions ?? []).length === 0 ? (
          <EmptyState icon="🧾" title={t("noTransactions", lang)} />
        ) : (
          <Card className="divide-y divide-stone-100 !p-0">
            {(wallet?.transactions ?? []).map((tx) => (
              <div key={tx.id} className="flex items-center justify-between px-4 py-3 text-sm">
                <div>
                  <p className="font-medium text-stone-700">{reasonLabel(tx.reason, lang)}</p>
                  <p className="text-[11px] text-stone-400">{formatDateTime(tx.createdAt, lang)}</p>
                </div>
                <span className={`font-bold ${tx.direction === "CREDIT" ? "text-green-700" : "text-red-600"}`}>
                  {tx.direction === "CREDIT" ? "+" : "−"}{formatBDT(tx.amountPaisa, lang)}
                </span>
              </div>
            ))}
          </Card>
        )}
      </section>

      {/* Withdrawal history */}
      <section>
        <h2 className="mb-2 font-semibold text-stone-700">{t("withdrawHistory", lang)}</h2>
        {!wallet && loading ? (
          <Card className="space-y-2">
            {[0, 1].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </Card>
        ) : withdrawals.length === 0 ? (
          <EmptyState icon="🏧" title={t("noWithdrawalsYet", lang)} />
        ) : (
          <Card className="divide-y divide-stone-100 !p-0">
            {withdrawals.map((wd) => (
              <div key={wd.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div>
                  <p className="font-bold text-stone-700">{formatBDT(wd.amountPaisa, lang)} · {channelLabel(wd.channel, lang)}</p>
                  <p className="text-[11px] text-stone-400">
                    {wd.refNo}{wd.destination ? ` · ${t("destinationLabel", lang)}: ${wd.destination}` : ""} · {formatDateTime(wd.createdAt, lang)}
                  </p>
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
                onChange={(e) => setWdAmount(e.target.value)}
                aria-invalid={Boolean(wdErr)}
              />
              <p className="mt-1 text-[11px] text-stone-400">
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
            {wdErr && <ErrorBanner message={wdErr} />}
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
