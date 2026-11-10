import { useState } from "react";
import { api, apiRaw } from "../../lib/api";
import type { OrderWithItems } from "../../lib/api-types";
import { invalidate, useResource } from "../../lib/useResource";
import { useSession } from "../../lib/session";
import { t } from "../../lib/i18n";
import { formatBDT, formatDateTime } from "../../lib/format";
import { orderStatusLabel, paymentStatusLabel } from "../../lib/labels";
import { Package, MapPin, Calendar, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Badge, BlockError, Card, EmptyState, IconButton, PageHeader, Skeleton, Spinner, useConfirm, useToast } from "../../components/ui";
import type { BadgeTone } from "../../components/ui";
import { mapError } from "../../lib/errors-ui";

/**
 * Line items arrive as immutable snapshots (`nameSnapshot`/`unitPricePaisa`) —
 * the API never joins the live product, so a price change or a delisted
 * product cannot rewrite order history.
 */

type TabKey = "all" | "active" | "delivered";

/**
 * The list plus the server's own total. `GET /orders` is a capped slice with no
 * page parameter, so a total larger than the array is the truncation signal the
 * screen must render (not paper over).
 */
interface OrdersPage {
  items: OrderWithItems[];
  total: number | null;
}

const STATUS_TONES: Record<string, BadgeTone> = {
  PENDING: "warning",
  CONFIRMED: "info",
  PAID: "brand",
  SHIPPED: "info",
  DELIVERED: "success",
  CANCELLED: "danger",
};

export default function MyOrders() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const [tab, setTab] = useState<TabKey>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** Order id whose DELETE is in flight — guards the handler and drives the button. */
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  // The screen reads one endpoint, so it holds one resource: the list owns the
  // loading, the failure and the refetch after a delete.
  const ordersRes = useResource<OrdersPage>("orders", async () => {
    // GET /orders returns a plain array (contract asserted in
    // apps/api/tests/journey-marketplace.test.ts) — not an { items } envelope.
    // The response is also a CAPPED slice (take: 100) and it is X-Total-Count,
    // not the body, that says whether it is the whole history. `apiRaw` is the
    // only way to reach that header; every `api()` call site keeps returning
    // `data` alone.
    const res = await apiRaw<OrderWithItems[] | { items?: OrderWithItems[] }>("GET", "/orders");
    const items = Array.isArray(res.data) ? res.data : (res.data?.items ?? []);
    const header = res.headers.get("X-Total-Count");
    const parsed = header === null ? NaN : Number(header);
    return { items, total: Number.isFinite(parsed) ? parsed : null };
  });

  const orders = ordersRes.data?.items ?? [];
  const ordersTotal = ordersRes.data?.total ?? null;
  /** The API served a window: say how many of the total are on screen. */
  const truncated = ordersTotal !== null && ordersTotal > orders.length;

  /** Finished orders can be removed; in-flight ones must be cancelled first. */
  function deletable(order: OrderWithItems): boolean {
    return !["PENDING", "CONFIRMED", "SHIPPED"].includes(order.status);
  }

  async function removeOrder(order: OrderWithItems) {
    if (deletingId) return;
    const okToDelete = await confirm({
      title: t("confirmTitle", lang),
      body: `${t("deleteOrderConfirm", lang)} ${order.orderNo}`,
      confirmLabel: t("deleteOrder", lang),
      danger: true,
    });
    if (!okToDelete) return;
    // The row used to sit unchanged — no spinner, no aria-busy — until the DELETE
    // returned and the refetch landed, which is exactly when a second tap is most
    // likely. The in-flight id drives the button's busy state.
    setDeletingId(order.id);
    try {
      await api("DELETE", `/orders/${order.id}`);
      toast.success(t("orderDeletedToast", lang));
      // The deleted row leaves the list: the old code awaited `load`, which
      // refetched exactly this one resource.
      invalidate("orders");
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      setDeletingId(null);
    }
  }

  const filtered = orders.filter((o) => {
    if (tab === "active") return o.status !== "DELIVERED" && o.status !== "CANCELLED";
    if (tab === "delivered") return o.status === "DELIVERED";
    return true;
  });

  const tabs: { key: TabKey; label: string }[] = [
    { key: "all", label: t("tabAll", lang) },
    { key: "active", label: t("ordTabActive", lang) },
    { key: "delivered", label: t("ordTabDelivered", lang) },
  ];

  return (
    <div className="min-w-0 space-y-5 overflow-hidden">
      {/* PageHeader, not a hand-rolled h1: this was the one screen whose heading
          did not match the shared one (size, icon tile, spacing), and its own h1
          carried a legacy `green-*` alias instead of the semantic token the other
          screens use. Same heading, same shell as every other page. */}
      <PageHeader icon={<Package className="h-5 w-5" aria-hidden />} title={t("myOrders", lang)} />

      {/* Tabs */}
      <div className="flex gap-2">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setTab(tb.key)}
            aria-pressed={tab === tb.key}
            className={`min-h-[44px] rounded-full px-4 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] ${
              tab === tb.key
                ? "bg-action text-white"
                : "bg-surface-card text-stone-600 ring-1 ring-surface-border-strong hover:bg-brand-50"
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      <BlockError error={ordersRes.error} retryLabel={t("retry", lang)} onRetry={() => void ordersRes.reload()} />

      {/* Truncation, stated. The list is a window over the server's capped slice
          and used to be presented as the whole history; the count comes from
          X-Total-Count, so it is the server's number, not the array's length. */}
      {truncated && (
        <p role="status" className="rounded-lg bg-info-bg px-3 py-2 text-xs font-medium text-info-text">
          {t("ordersTruncatedNotice", lang, { shown: orders.length, total: ordersTotal })}
        </p>
      )}

      {ordersRes.loading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="space-y-3">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-6 w-48" />
            </Card>
          ))}
        </div>
      )}

      {!ordersRes.loading && filtered.length === 0 && !ordersRes.error && (
        <EmptyState
          icon={<Package className="h-10 w-10 text-stone-300" aria-hidden />}
          title={t("ordEmptyTitle", lang)}
          // Both descriptions said the same thing as the title from a different
          // angle ("you don't have any orders yet" / "no orders in this category
          // yet"); the tab row above already shows which list is empty.
        />
      )}

      {!ordersRes.loading && filtered.map((order) => {
        const isExpanded = expandedId === order.id;
        const refunded = order.paymentStatus === "REFUNDED";

        return (
          <Card key={order.id} className="overflow-hidden">
            {/* Summary row */}
            <div className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-bold text-stone-800">{order.orderNo}</span>
                  <Badge tone={STATUS_TONES[order.status] ?? "default"}>
                    {orderStatusLabel(order.status, lang)}
                  </Badge>
                  {refunded && <Badge tone="warning">{paymentStatusLabel(order.paymentStatus, lang)}</Badge>}
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-stone-500">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" aria-hidden />
                    {formatDateTime(order.createdAt, lang)}
                  </span>
                  <span className="font-bold text-accent">{formatBDT(order.totalPaisa, lang)}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center">
                {deletable(order) && (
                  // IconButton's 44px target with the danger tokens; the raw
                  // text-red-600/hover:bg-red-50/ring-red-500 palette bypassed the
                  // danger triplet every other destructive control uses, and the
                  // button had no in-flight state, so a second tap was invisible.
                  <IconButton
                    variant="ghost"
                    label={`${t("deleteOrder", lang)} ${order.orderNo}`}
                    disabled={deletingId === order.id}
                    aria-busy={deletingId === order.id || undefined}
                    onClick={() => void removeOrder(order)}
                    className="text-danger-text hover:bg-danger-bg focus-visible:ring-danger-border disabled:bg-transparent"
                  >
                    {deletingId === order.id ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" aria-hidden />}
                  </IconButton>
                )}
                <IconButton
                  label={isExpanded ? t("collapseDetails", lang) : t("expandDetails", lang)}
                  onClick={() => setExpandedId(isExpanded ? null : order.id)}
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? <ChevronUp className="h-4 w-4" aria-hidden /> : <ChevronDown className="h-4 w-4" aria-hidden />}
                </IconButton>
              </div>
            </div>

            {/* Expanded details */}
            {isExpanded && (
              <div className="border-t border-stone-100 bg-stone-50 px-4 py-3 text-sm">
                {/* h2, not h3: the only heading above this on the page is its h1,
                    so h3 skipped a level (axe heading-order). */}
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                  {t("ordItemsTitle", lang)}
                </h2>
                <ul className="divide-y divide-stone-200">
                  {order.items.map((item) => (
                    <li key={item.id} className="flex justify-between py-1.5">
                      <span className="text-stone-700">{item.nameSnapshot} × {item.qty}</span>
                      <span className="text-stone-600">{formatBDT(item.unitPricePaisa * item.qty, lang)}</span>
                    </li>
                  ))}
                </ul>

                {/* Breakdown */}
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <dt className="text-stone-500">{t("orderSubtotal", lang)}</dt>
                  <dd className="text-right text-stone-700">{formatBDT(order.subtotalPaisa, lang)}</dd>
                  {order.discountPaisa > 0 && (
                    <>
                      <dt className="text-stone-500">{t("orderDiscount", lang)}</dt>
                      <dd className="text-right font-medium text-success-text">−{formatBDT(order.discountPaisa, lang)}</dd>
                    </>
                  )}
                  <dt className="text-stone-500">{t("orderDeliveryFee", lang)}</dt>
                  <dd className="text-right text-stone-700">{order.deliveryFeePaisa === 0 ? t("freeLabel", lang) : formatBDT(order.deliveryFeePaisa, lang)}</dd>
                </dl>

                {/* Delivery address */}
                <div className="mt-3 rounded-lg bg-white p-2.5 text-xs">
                  <p className="flex items-center gap-1.5 font-semibold text-stone-700">
                    <MapPin className="h-3.5 w-3.5 text-stone-500" aria-hidden />
                    {t("deliveryAddressLabel", lang)}
                  </p>
                  {order.shippingAddress ? (
                    <>
                      {order.shippingName && (
                        <p className="mt-0.5 text-stone-600">
                          <span className="text-stone-500">{t("ordReceiverLabel", lang)}: </span>
                          {order.shippingName}
                        </p>
                      )}
                      <p className="mt-0.5 break-all text-stone-600">{order.shippingAddress}</p>
                      {order.shippingPhone && <p className="mt-0.5 text-stone-600">{order.shippingPhone}</p>}
                    </>
                  ) : (
                    // Orders placed before the delivery form was wired up carry no
                    // address; say so instead of rendering an empty box.
                    <p className="mt-0.5 text-stone-500">{t("ordNoAddress", lang)}</p>
                  )}
                  <p className="mt-1 text-stone-500">
                    <span>{t("ordPaymentLabel", lang)}: </span>
                    {paymentStatusLabel(order.paymentStatus, lang)}
                  </p>
                </div>

                {/* Last updated */}
                <p className="mt-2 text-2xs text-stone-500">
                  {t("ordLastUpdated", lang)}: {formatDateTime(order.updatedAt, lang)}
                </p>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
