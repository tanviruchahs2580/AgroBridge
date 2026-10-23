import { useMemo, useState } from "react";
import { api, ApiError } from "../../lib/api";
import type { MembershipPlan, PaymentIntent, PaymentListItem, WalletData, WalletSummary, Withdrawal } from "../../lib/api-types";
import { invalidate, useResource } from "../../lib/useResource";
import { useSession } from "../../lib/session";
import { t } from "../../lib/i18n";
import { formatBDT, formatDateTime, takaToPaisa } from "../../lib/format";
import { channelLabel, membershipBenefitLabel, paymentPurposeLabel, reasonLabel, tierLabel, withdrawalStatusLabel } from "../../lib/labels";
import { mapError } from "../../lib/errors-ui";
import { track } from "../../lib/analytics";
import { ArrowDownCircle, ArrowUpCircle, Check, Clock3, Landmark, Receipt, Wallet } from "lucide-react";
import {
  Badge, BlockError, Button, Card, EmptyState, ErrorBanner, Input, Label, Modal, PageHeader, SectionHeader, Select, Skeleton, StatTile, useConfirm, useToast,
} from "../../components/ui";

const MIN_WITHDRAWAL_PAISA = 10_000; // mirrors API rule
const CHANNELS = ["BKASH", "NAGAD", "BANK"] as const;

export default function WalletPage() {
  const { session, refresh } = useSession();
  const lang = session?.lang ?? "bn";
  const toast = useToast();
  const confirm = useConfirm();

  // The page reads five independent endpoints, so it holds five independent
  // resources: a failure in any one block leaves the others on screen.
  const walletRes = useResource<WalletData>("wallet", () => api<WalletData>("GET", "/wallet"));
  const summaryRes = useResource<WalletSummary>("wallet-summary", () => api<WalletSummary>("GET", "/wallet/summary"));
  const withdrawalsRes = useResource<Withdrawal[]>("wallet-withdrawals", () => api<Withdrawal[]>("GET", "/wallet/withdrawals"));
  const paymentsRes = useResource<PaymentListItem[]>("wallet-payments", () => api<PaymentListItem[]>("GET", "/payments"));
  const plansRes = useResource<MembershipPlan[]>("wallet-plans", () => api<MembershipPlan[]>("GET", "/membership/plans"));

  const wallet = walletRes.data;
  const summary = summaryRes.data;
  const withdrawals = withdrawalsRes.data ?? [];
  const plans = plansRes.data ?? [];

  // Withdraw dialog
  const [wdOpen, setWdOpen] = useState(false);
  const [wdAmount, setWdAmount] = useState("");
  const [wdChannel, setWdChannel] = useState<(typeof CHANNELS)[number]>("BKASH");
  const [wdErr, setWdErr] = useState("");
  const [wdBusy, setWdBusy] = useState(false);
  const [planBusyTier, setPlanBusyTier] = useState<string | null>(null);

  async function buyPlan(tier: string) {
    // In-flight guard before the dialog: a second activation used to open a second
    // confirm and reach a second POST /payments/intent for the same tier.
    if (planBusyTier) return;
    const plan = plans.find((p) => p.tier === tier);
    const okToBuy = await confirm({
      title: t("membershipConfirmTitle", lang),
      body: t("membershipConfirmBody", lang, {
        tier: tierLabel(tier, lang),
        price: plan ? formatBDT(plan.pricePaisa, lang) : "—",
      }),
      confirmLabel: t("payNow", lang),
      cancelLabel: t("cancel", lang),
    });
    if (!okToBuy) return;
    setPlanBusyTier(tier);
    try {
      const intent = await api<PaymentIntent>("POST", "/payments/intent", {
        purposeType: "MEMBERSHIP",
        purposeId: tier,
      });

      if (intent.redirectUrl) {
        // Real gateway: the purchase completes on the hosted checkout page and
        // the membership is activated by the verified payment, not by this click.
        window.location.assign(intent.redirectUrl);
        return;
      }
      if (intent.providerMode !== "sandbox") {
        // Nothing was collected, so nothing is activated — report pending
        // instead of a success that did not happen.
        toast.info(t("paymentPendingNote", lang));
        return;
      }
      await api("POST", `/payments/${intent.paymentId}/confirm`);
      toast.success(t("membershipActiveToast", lang, { tier: tierLabel(tier, lang) }));
      // The purchase moves the balance, the month summary and the payment list
      // (and the membership tier); the previous refetch set plus the plans.
      invalidate("wallet");
      invalidate("wallet-summary");
      invalidate("wallet-withdrawals");
      invalidate("wallet-payments");
      invalidate("wallet-plans");
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === "PAYMENT_GATEWAY_NOT_CONFIGURED") {
        toast.info(t("paymentPendingNote", lang));
        return;
      }
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
    // A withdrawal POST is not idempotent; the button's `loading` state only
    // appears after a re-render, which is a window a second tap can use.
    if (wdBusy) return;
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
      // The new request moves the balance and the month summary and adds a
      // history row; those three resources own all of it.
      invalidate("wallet");
      invalidate("wallet-summary");
      invalidate("wallet-withdrawals");
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      setWdBusy(false);
    }
  }

  // Wallet ledger merged with payment records (orders/bookings paid outside the
  // wallet balance; WALLET_CREDIT skipped to avoid double rows). Derived from
  // whichever of the two resources has data, so one failure still shows the other.
  const ledgerRows = useMemo(() => {
    const txnRows = (walletRes.data?.transactions ?? []).map((tx) => ({
      id: tx.id,
      label: reasonLabel(tx.reason, lang),
      ref: tx.id,
      amountPaisa: tx.amountPaisa,
      credit: tx.direction === "CREDIT",
      createdAt: tx.createdAt,
    }));
    const paymentRows = (paymentsRes.data ?? [])
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
    return [...txnRows, ...paymentRows].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [walletRes.data, paymentsRes.data, lang]);

  const ledgerLoading = walletRes.loading || paymentsRes.loading;
  const ledgerFailed = Boolean(walletRes.error || paymentsRes.error);

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader icon={<Wallet className="h-5 w-5" aria-hidden />} title={t("wallet", lang)} />

      {/* Summary cards row — balance hero card + StatTile metrics */}
      <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
        <Card className="min-w-0 overflow-hidden bg-hero text-white">
          <p className="text-xs opacity-80">{t("balance", lang)}</p>
          <div aria-live="polite" aria-atomic="true">
            {wallet ? (
              <p className="mt-0.5 text-2xl font-bold">{formatBDT(wallet.balancePaisa, lang)}</p>
            ) : walletRes.loading ? (
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
        {summary ? (
          <>
            <StatTile tone="success" icon={<ArrowUpCircle className="h-5 w-5" aria-hidden />} value={formatBDT(summary.monthCreditsPaisa, lang)} label={t("monthIn", lang)} />
            <StatTile tone="danger" icon={<ArrowDownCircle className="h-5 w-5" aria-hidden />} value={formatBDT(summary.monthDebitsPaisa, lang)} label={t("monthOut", lang)} />
            <StatTile tone="warning" icon={<Clock3 className="h-5 w-5" aria-hidden />} value={formatBDT(summary.pendingWithdrawalsPaisa, lang)} label={t("pendingWithdrawals", lang)} />
          </>
        ) : summaryRes.loading ? (
          [0, 1, 2].map((i) => (
            <Card key={i} variant="static" className="min-w-0 overflow-hidden">
              <Skeleton className="mt-1 h-10 w-full" />
            </Card>
          ))
        ) : (
          <div className="col-span-2 lg:col-span-3">
            <BlockError error={summaryRes.error} retryLabel={t("retry", lang)} onRetry={() => void summaryRes.reload()} />
          </div>
        )}
      </div>

      {/* Balance failed: the hero card keeps its place with "—" and the
          withdraw button disabled; the retry lives with the error. */}
      <BlockError error={walletRes.error} retryLabel={t("retry", lang)} onRetry={() => void walletRes.reload()} />

      {/* Membership */}
      <section>
        <SectionHeader title={t("membership", lang)} />
        <div className="space-y-2">
          <BlockError error={plansRes.error} retryLabel={t("retry", lang)} onRetry={() => void plansRes.reload()} />
          <div className="grid gap-2 sm:gap-4 sm:grid-cols-3">
            {plans.map((p) => (
              <Card key={p.tier} className={`min-w-0 overflow-hidden ${p.tier === "GOLD" ? "border-amber-300" : p.tier === "SILVER" ? "border-stone-300" : ""}`}>
                <h3 className="font-bold text-stone-800">{tierLabel(p.tier, lang)}</h3>
                <p className="my-1 text-xl font-bold text-accent">
                  {p.pricePaisa === 0 ? t("freeLabel", lang) : formatBDT(p.pricePaisa, lang)}
                </p>
                <ul className="mb-3 space-y-1 text-xs text-stone-600">
                  {p.benefits.map((b, i) => (
                    <li key={i} className="flex items-center gap-1"><Check className="h-3 w-3 text-success-text" aria-hidden /> {membershipBenefitLabel(b, lang)}</li>
                  ))}
                </ul>
                {summary?.membership?.tier === p.tier && summary.membership.expiresAt && (() => {
                  const daysLeft = Math.ceil((new Date(summary.membership!.expiresAt!).getTime() - Date.now()) / 86400000);
                  if (daysLeft <= 7 && daysLeft >= 0) return <Badge tone="warning" className="mb-2">{t("walletExpiresIn", lang, { days: daysLeft })}</Badge>;
                  if (daysLeft < 0) return <Badge tone="danger" className="mb-2">{t("membershipExpired", lang)}</Badge>;
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
        </div>
      </section>

      {/* Transactions — wallet ledger merged with payment records. Shares the
          wallet resource with the balance card and owns the payments resource. */}
      <section>
        <SectionHeader title={t("transactionsTitle", lang)} />
        <div className="space-y-2">
          <BlockError error={walletRes.error} retryLabel={t("retry", lang)} onRetry={() => void walletRes.reload()} />
          <BlockError error={paymentsRes.error} retryLabel={t("retry", lang)} onRetry={() => void paymentsRes.reload()} />
          {ledgerLoading ? (
            <Card className="space-y-2">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </Card>
          ) : ledgerRows.length === 0 ? (
            // A failed half must not read as "no transactions".
            ledgerFailed ? null : (
              <EmptyState headingLevel={3} icon={<Receipt className="h-10 w-10 text-stone-300" aria-hidden />} title={t("noTransactions", lang)} />
            )
          ) : (
            <Card variant="static" padded={false} className="divide-y divide-stone-100">
              {ledgerRows.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-2 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="break-words font-medium text-stone-700 [overflow-wrap:anywhere]">{row.label}</p>
                    <p className="break-words text-xs text-stone-500 [overflow-wrap:anywhere]">{formatDateTime(row.createdAt, lang)}</p>
                    <p className="break-all text-xs font-mono text-stone-500 [overflow-wrap:anywhere]">{row.ref}</p>
                  </div>
                  <span className={`font-bold ${row.credit ? "text-success-text" : "text-danger-text"}`}>
                    {row.credit ? "+" : "−"}{formatBDT(row.amountPaisa, lang)}
                  </span>
                </div>
              ))}
            </Card>
          )}
        </div>
      </section>

      {/* Withdrawal history */}
      <section>
        <SectionHeader title={t("withdrawHistory", lang)} />
        <div className="space-y-2">
          <BlockError error={withdrawalsRes.error} retryLabel={t("retry", lang)} onRetry={() => void withdrawalsRes.reload()} />
          {withdrawalsRes.loading ? (
            <Card className="space-y-2">
              {[0, 1].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </Card>
          ) : withdrawals.length === 0 ? (
            withdrawalsRes.error ? null : (
              <EmptyState headingLevel={3} icon={<Landmark className="h-10 w-10 text-stone-300" aria-hidden />} title={t("noWithdrawalsYet", lang)} />
            )
          ) : (
            <Card variant="static" padded={false} className="divide-y divide-stone-100">
              {withdrawals.map((wd) => (
                <div key={wd.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="break-words font-bold text-stone-700 [overflow-wrap:anywhere]">{formatBDT(wd.amountPaisa, lang)} · {channelLabel(wd.channel, lang)}</p>
                    <p className="break-all text-xs text-stone-500 [overflow-wrap:anywhere]">
                      {wd.refNo}{wd.destination ? ` · ${t("destinationLabel", lang)}: ${wd.destination}` : ""} · {formatDateTime(wd.createdAt, lang)}
                    </p>
                    <p className="break-all text-xs font-mono text-stone-500 [overflow-wrap:anywhere]">{wd.id}</p>
                  </div>
                  <Badge tone={wd.status === "PAID" ? "success" : wd.status === "REJECTED" ? "danger" : "warning"}>
                    {withdrawalStatusLabel(wd.status, lang)}
                  </Badge>
                </div>
              ))}
            </Card>
          )}
        </div>
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
              <p className="mt-1 text-xs text-stone-500">
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
            {/* The wrapper carries the id the amount input points at via
                aria-describedby; it must not also carry role="alert", because
                ErrorBanner is itself role="alert" and the message was announced
                twice from two nested live regions. */}
            {wdErr && <div id="wd-amount-err"><ErrorBanner message={wdErr} /></div>}
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
