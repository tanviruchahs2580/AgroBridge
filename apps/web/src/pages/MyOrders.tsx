import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useSession } from "../lib/session";
import { t } from "../lib/i18n";
import { formatBDT, formatDateTime } from "../lib/format";
import { Package, MapPin, Calendar, ChevronDown, ChevronUp } from "lucide-react";
import { Badge, Button, Card, EmptyState, ErrorBanner, Skeleton } from "../components/ui";

interface OrderItem {
  id: string;
  qty: number;
  product: { name: string; pricePaisa: number };
}

interface Order {
  id: string;
  orderNo: string;
  status: string;
  subtotalPaisa: number;
  discountPaisa: number;
  deliveryFeePaisa: number;
  totalPaisa: number;
  items: OrderItem[];
  addressLine: string;
  phone: string;
  createdAt: string;
  updatedAt: string;
}

type TabKey = "all" | "active" | "delivered";

const STATUS_MAP: Record<string, { labelBn: string; labelEn: string; badgeClass: string }> = {
  PENDING: { labelBn: "অপেক্ষমাণ", labelEn: "Pending", badgeClass: "bg-amber-100 text-amber-800 border-amber-200" },
  CONFIRMED: { labelBn: "নিশ্চিত", labelEn: "Confirmed", badgeClass: "bg-blue-100 text-blue-800 border-blue-200" },
  SHIPPED: { labelBn: "শিপিংয়ে", labelEn: "Shipped", badgeClass: "bg-purple-100 text-purple-800 border-purple-200" },
  DELIVERED: { labelBn: "ডেলিভার্ড", labelEn: "Delivered", badgeClass: "bg-green-100 text-green-800 border-green-200" },
  CANCELLED: { labelBn: "বাতিল", labelEn: "Cancelled", badgeClass: "bg-red-100 text-red-700 border-red-200" },
};

export default function MyOrders() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [tab, setTab] = useState<TabKey>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const data = await api<{ items: Order[] }>("GET", "/orders?pageSize=50");
        setOrders(data.items);
      } catch {
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = orders.filter((o) => {
    if (tab === "active") {
      const s = STATUS_MAP[o.status] || STATUS_MAP[o.status];
      return o.status !== "DELIVERED" && o.status !== "CANCELLED";
    }
    if (tab === "delivered") return o.status === "DELIVERED";
    return true;
  });

  const tabs: { key: TabKey; label: string }[] = [
    { key: "all", label: t("tabAll", lang) },
    { key: "active", label: lang === "bn" ? "সক্রিয়" : "Active" },
    { key: "delivered", label: lang === "bn" ? "ডেলিভার্ড" : "Delivered" },
  ];

  return (
    <div className="min-w-0 space-y-5 overflow-hidden px-2 sm:px-0">
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
            className={`min-h-[40px] rounded-full px-4 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 ${
              tab === tb.key
                ? "bg-green-700 text-white"
                : "bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-green-50"
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="space-y-2">
          <ErrorBanner message={t("errorGeneric", lang)} />
          <Button variant="outline" onClick={() => window.location.reload()}>
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
          title={lang === "bn" ? "কোনো অর্ডার নাই" : "No orders yet"}
          description={
            tab === "all"
              ? lang === "bn"
                ? "আপনোর এখনো কোনো অর্ডার নাই। বাজার থেকে পণ্য কিনে শুরু করুন।"
                : "You don't have any orders yet. Start shopping from the market."
              : lang === "bn"
                ? "এই ক্যাটাগরিতে কোনো অর্ডার নাই।"
                : "No orders in this category yet."
          }
        />
      )}

      {!loading && filtered.map((order) => {
        const statusInfo = STATUS_MAP[order.status] || {
          labelBn: order.status,
          labelEn: order.status,
          badgeClass: "bg-stone-100 text-stone-600 border-stone-200",
        };
        const isExpanded = expandedId === order.id;

        return (
          <Card key={order.id} className="overflow-hidden">
            {/* Summary row */}
            <div className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold text-green-800">{order.orderNo}</span>
                  <Badge className={statusInfo.badgeClass}>{lang === "bn" ? statusInfo.labelBn : statusInfo.labelEn}</Badge>
                </div>
                <div className="mt-1 flex items-center gap-3 text-xs text-stone-500">
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" aria-hidden />
                    {formatDateTime(order.createdAt, lang)}
                  </span>
                  <span className="font-bold text-green-800">{formatBDT(order.totalPaisa, lang)}</span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : order.id)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-stone-400 hover:bg-stone-100"
                aria-label={isExpanded ? "Collapse" : "Expand"}
              >
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
            </div>

            {/* Expanded details */}
            {isExpanded && (
              <div className="border-t border-stone-100 bg-stone-50 px-4 py-3 text-sm">
                {/* Items */}
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
                  {lang === "bn" ? "পণ্যসমূহ" : "Items"}
                </h3>
                <ul className="divide-y divide-stone-200">
                  {order.items.map((item) => (
                    <li key={item.id} className="flex justify-between py-1.5">
                      <span className="text-stone-700">{item.product.name} × {item.qty}</span>
                      <span className="text-stone-600">{formatBDT(item.product.pricePaisa * item.qty, lang)}</span>
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
                    <MapPin className="h-3.5 w-3.5 text-stone-400" aria-hidden />
                    {lang === "bn" ? "ডেলিভারি ঠিকানা" : "Delivery address"}
                  </p>
                  <p className="mt-0.5 text-stone-600 break-all">{order.addressLine}</p>
                  {order.phone && <p className="mt-0.5 text-stone-600">{order.phone}</p>}
                </div>

                {/* Last updated */}
                <p className="mt-2 text-[10px] text-stone-400">
                  {lang === "bn" ? "সর্বশেষ হালনাগাদ" : "Last updated"}: {formatDateTime(order.updatedAt, lang)}
                </p>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}
