import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useSession } from "../../lib/session";
import { t } from "../../lib/i18n";
import { formatBDT, formatDateTime } from "../../lib/format";
import { orderStatusLabel, paymentStatusLabel } from "../../lib/labels";
import { Package, MapPin, Calendar, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorBanner, Skeleton, useConfirm, useToast } from "../../components/ui";
import type { BadgeTone } from "../../components/ui";
import { mapError } from "../../lib/errors-ui";

/**
 * Line items arrive as immutable snapshots (`nameSnapshot`/`unitPricePaisa`) —
 * the API never joins the live product, so a price change or a delisted
 * product cannot rewrite order history.
 */
interface OrderItem {
  id: string;
  qty: number;
  nameSnapshot: string;
  skuSnapshot?: string;
  unitPricePaisa: number;
}

interface Order {
  id: string;
  orderNo: string;
  status: string;
  paymentStatus: string;
  subtotalPaisa: number;
  discountPaisa: number;
  deliveryFeePaisa: number;
  totalPaisa: number;
  items: OrderItem[];
  shippingName: string | null;
  shippingPhone: string | null;
  shippingAddress: string | null;
  createdAt: string;
  updatedAt: string;
}

type TabKey = "all" | "active" | "delivered";

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
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<TabKey>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    setLoadError(false);
    try {
      // GET /orders returns a plain array (contract asserted in
      // apps/api/tests/journey-marketplace.test.ts) — not an { items } envelope.
      const data = await api<Order[] | { items?: Order[] }>("GET", "/orders");
      setOrders(Array.isArray(data) ? data : (data?.items ?? []));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  /** Finished orders can be removed; in-flight ones must be cancelled first. */
  function deletable(order: Order): boolean {
    return !["PENDING", "CONFIRMED", "SHIPPED"].includes(order.status);
  }

  async function removeOrder(order: Order) {
    const okToDelete = await confirm({
      title: t("confirmTitle", lang),
      body: `${t("deleteOrderConfirm", lang)} ${order.orderNo}`,
      confirmLabel: t("deleteOrder", lang),
      danger: true,
    });
    if (!okToDelete) return;
    try {
      await api("DELETE", `/orders/${order.id}`);
      toast.success(t("orderDeletedToast", lang));
      await load();
    } catch (err) {
      toast.error(mapError(err, lang));
    }
  }

  const filtered = (orders || []).filter((o) => {
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
      <h1 className="flex items-center gap-2 text-xl font-bold text-stone-800">
        <Package className="h-6 w-6 text-green-700" aria-hidden />
        {t("myOrders", lang)}
      </h1>

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

      {loadError && (
        <div className="space-y-2">
          <ErrorBanner message={t("errorGeneric", lang)} />
          <Button variant="outline" onClick={() => void load()}>
            {t("retry", lang)}
          </Button>
        </div>
      )}

      {loading && (
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

      {!loading && filtered.length === 0 && (
        <EmptyState
          icon={<Package className="h-10 w-10 text-stone-300" aria-hidden />}
          title={t("ordEmptyTitle", lang)}
          description={
            tab === "all" ? t("ordEmptyAllHint", lang) : t("ordEmptyFilteredHint", lang)
          }
        />
      )}

      {!loading && filtered.map((order) => {
        const isExpanded = expandedId === order.id;
        const refunded = order.paymentStatus === "REFUNDED";

        return (
          <Card key={order.id} className="overflow-hidden">
            {/* Summary row */}
            <div className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-bold text-green-800">{order.orderNo}</span>
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
                  <span className="font-bold text-green-800">{formatBDT(order.totalPaisa, lang)}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center">
                {deletable(order) && (
                  <button
                    type="button"
                    onClick={() => void removeOrder(order)}
                    className="flex h-11 w-11 items-center justify-center rounded-full text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                    aria-label={`${t("deleteOrder", lang)} ${order.orderNo}`}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : order.id)}
                  aria-expanded={isExpanded}
                  className="flex h-11 w-11 items-center justify-center rounded-full text-stone-500 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]"
                  aria-label={isExpanded ? t("collapseDetails", lang) : t("expandDetails", lang)}
                >
                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Expanded details */}
            {isExpanded && (
              <div className="border-t border-stone-100 bg-stone-50 px-4 py-3 text-sm">
                {/* Items */}
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                  {t("ordItemsTitle", lang)}
                </h3>
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
                      <dd className="text-right font-medium text-green-700">−{formatBDT(order.discountPaisa, lang)}</dd>
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
                <p className="mt-2 text-[10px] text-stone-500">
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
