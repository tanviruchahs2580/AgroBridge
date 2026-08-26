import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useSession } from "../lib/session.js";
import { t } from "../lib/i18n.js";
import type { DictKey } from "../lib/i18n.js";
import { formatBDT } from "../lib/format.js";
import { categoryLabel } from "../lib/labels.js";
import { mapError, BD_PHONE_RE } from "../lib/errors-ui.js";
import { track } from "../lib/analytics.js";
import {
  Badge, Button, Card, EmptyState, ErrorBanner, Input, Label, Modal, Skeleton, Stepper, useToast,
} from "../components/ui.jsx";

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
  productId?: string;
  qty: number;
  product: { id: string; name: string; pricePaisa: number };
}
interface Order {
  id: string;
  orderNo: string;
  subtotalPaisa: number;
  discountPaisa: number;
  deliveryFeePaisa: number;
  totalPaisa: number;
}

const CATEGORY_FILTERS: { value: string; key: DictKey }[] = [
  { value: "", key: "catAll" },
  { value: "SEED", key: "catSEED" },
  { value: "FERTILIZER", key: "catFERTILIZER" },
  { value: "BIO_INPUT", key: "catBIO_INPUT" },
  { value: "CROP_PROTECTION", key: "catCROP_PROTECTION" },
  { value: "EQUIPMENT", key: "catEQUIPMENT" },
];

const WIZARD_STEPS: DictKey[] = ["checkoutStepCart", "checkoutStepDelivery", "checkoutStepReview", "checkoutStepPayment", "checkoutStepSuccess"];
const DELIVERY_STEP = 1;
const REVIEW_STEP = 2;
const PAY_STEP = 3;
const SUCCESS_STEP = 4;

export default function Market() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const toast = useToast();

  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [category, setCategory] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartBusyIds, setCartBusyIds] = useState<Set<string>>(new Set());
  const [cartError, setCartError] = useState(false);

  // Checkout wizard
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [prefillDone, setPrefillDone] = useState(false);
  const [deliveryErrs, setDeliveryErrs] = useState<{ address?: string; phone?: string }>({});
  const [order, setOrder] = useState<Order | null>(null);
  const [paid, setPaid] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [paying, setPaying] = useState(false);

  const loadProducts = useCallback(
    async (cat: string) => {
      setProductsLoading(true);
      setLoadError(false);
      try {
        const data = await api<{ items: Product[] }>("GET", `/products?pageSize=50${cat ? `&category=${cat}` : ""}`);
        setProducts(data.items);
      } catch {
        setLoadError(true);
      } finally {
        setProductsLoading(false);
      }
    },
    []
  );

  const loadCart = useCallback(async () => {
    const data = await api<{ items: CartItem[] }>("GET", "/cart");
    setCart(data.items);
  }, []);

  useEffect(() => {
    void loadProducts(category);
  }, [category, loadProducts]);

  useEffect(() => {
    setCartError(false);
    loadCart().catch(() => setCartError(true));
  }, [loadCart]);

  useEffect(() => {
    track("market_view", { category: category || "ALL" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function markBusy(id: string, busy: boolean) {
    setCartBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function addToCart(p: Product) {
    markBusy(p.id, true);
    try {
      await api("POST", "/cart/items", { productId: p.id, qty: 1 });
      track("product_added_to_cart", { productId: p.id });
      await loadCart();
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      markBusy(p.id, false);
    }
  }

  /** POST /cart/items upserts an ABSOLUTE qty (verified against marketplace routes). */
  async function changeQty(item: CartItem, delta: number) {
    const productId = item.product?.id ?? item.productId;
    if (!productId) return;
    const nextQty = item.qty + delta;
    markBusy(item.id, true);
    try {
      if (nextQty <= 0) {
        await api("DELETE", `/cart/items/${productId}`);
      } else {
        await api("POST", "/cart/items", { productId, qty: nextQty });
      }
      await loadCart();
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      markBusy(item.id, false);
    }
  }

  async function removeLine(item: CartItem) {
    const productId = item.product?.id ?? item.productId;
    if (!productId) return;
    markBusy(item.id, true);
    try {
      await api("DELETE", `/cart/items/${productId}`);
      await loadCart();
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      markBusy(item.id, false);
    }
  }

  async function openWizard() {
    setWizardOpen(true);
    setStep(0);
    setOrder(null);
    setPaid(false);
    setDeliveryErrs({});
    if (!prefillDone) {
      setPrefillDone(true);
      try {
        const me = await api<{ phone: string; farmerProfile?: { district?: string; upazila?: string; address?: string } }>("GET", "/auth/me");
        const fp = me.farmerProfile;
        setAddress(fp?.address ?? [fp?.district, fp?.upazila].filter(Boolean).join(", "));
        setPhone(me.phone.startsWith("01") ? me.phone : "");
      } catch (err) {
        // Prefill is best-effort — the wizard still works with empty fields.
        console.warn("[market] profile prefill failed", err);
      }
    }
  }

  function closeWizard() {
    setWizardOpen(false);
  }

  function goDelivery() {
    setDeliveryErrs({});
    setStep(DELIVERY_STEP);
  }

  function submitDelivery(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof deliveryErrs = {};
    if (address.trim().length < 5) errs.address = t("errFieldRequired", lang);
    if (!BD_PHONE_RE.test(phone.trim())) errs.phone = t("errPhoneInvalid", lang);
    setDeliveryErrs(errs);
    if (Object.keys(errs).length === 0) setStep(REVIEW_STEP);
  }

  async function placeOrder() {
    setPlacing(true);
    try {
      const o = await api<Order>("POST", "/orders/checkout");
      setOrder(o);
      setStep(PAY_STEP);
      // Order already created; a failed refresh must not block payment.
      loadCart().catch((e) => console.warn("[market] post-checkout cart refresh failed", e));
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      setPlacing(false);
    }
  }

  async function pay() {
    if (!order) return;
    setPaying(true);
    try {
      const intent = await api<{ paymentId: string; providerMode: string }>("POST", "/payments/intent", {
        purposeType: "ORDER",
        purposeId: order.id,
      });
      if (intent.providerMode === "sandbox") {
        await api("POST", `/payments/${intent.paymentId}/confirm`);
        setPaid(true);
      }
      track("checkout_completed", { totalPaisa: order.totalPaisa });
      toast.success(t("checkoutOrderPlaced", lang));
      setStep(SUCCESS_STEP);
      // Order + payment already succeeded; refresh failures are non-blocking.
      await Promise.all([
        loadCart().catch((e) => console.warn("[market] post-payment cart refresh failed", e)),
        loadProducts(category),
      ]);
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      setPaying(false);
    }
  }

  const subtotalPaisa = cart.reduce((s, i) => s + i.product.pricePaisa * i.qty, 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold text-stone-800"><span aria-hidden>🛒</span> {t("market", lang)}</h1>

      <div className="flex flex-wrap gap-2">
        {CATEGORY_FILTERS.map((c) => (
          <button
            key={c.value || "all"}
            type="button"
            onClick={() => setCategory(c.value)}
            aria-pressed={category === c.value}
            className={`min-h-[44px] rounded-full px-4 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 ${
              category === c.value ? "bg-green-700 text-white" : "bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-green-50"
            }`}
          >
            {t(c.key, lang)}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="space-y-2">
          <ErrorBanner message={t("errorGeneric", lang)} />
          <Button variant="outline" onClick={() => void loadProducts(category)}>{t("retry", lang)}</Button>
        </div>
      )}

      {cartError && (
        <div className="space-y-2">
          <ErrorBanner message={t("errorGeneric", lang)} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCartError(false);
              loadCart().catch(() => setCartError(true));
            }}
          >
            {t("retry", lang)}
          </Button>
        </div>
      )}

      {productsLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-9 w-full" />
            </Card>
          ))}
        </div>
      ) : products.length === 0 && !loadError ? (
        <EmptyState icon="🧺" title={t("noProducts", lang)} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <Card key={p.id} className="flex flex-col justify-between">
              <div>
                <div className="mb-1 flex items-start justify-between gap-2">
                  <h3 className="text-sm font-bold leading-snug text-stone-800">{p.name}</h3>
                  <Badge className="shrink-0 bg-stone-100 text-stone-500">{categoryLabel(p.category, lang)}</Badge>
                </div>
                <p className="text-lg font-bold text-green-800">
                  {formatBDT(p.pricePaisa, lang)} <span className="text-xs font-normal text-stone-400">/ {p.unit}</span>
                </p>
                <p className={`mt-0.5 text-[11px] ${p.stockQty > 0 ? "text-stone-400" : "font-semibold text-red-600"}`}>
                  {p.stockQty > 0 ? t("stockLeft", lang, { n: p.stockQty }) : t("outOfStock", lang)}
                </p>
              </div>
              <Button className="mt-3 w-full" disabled={p.stockQty === 0} loading={cartBusyIds.has(p.id)} onClick={() => void addToCart(p)}>
                + {t("addToCart", lang)}
              </Button>
            </Card>
          ))}
        </div>
      )}

      {/* Sticky cart bar: bottom-24 clears the mobile BottomNav */}
      {cart.length > 0 && !wizardOpen && (
        <div className="sticky bottom-24 z-20 md:bottom-4">
          <Card className="flex items-center justify-between gap-3 border-green-200 ring-1 ring-green-100">
            <p className="text-sm font-semibold text-stone-700">
              <span aria-hidden>🧺</span> {t("cartItemsCount", lang, { n: cart.length })} · {formatBDT(subtotalPaisa, lang)}
            </p>
            <Button onClick={() => void openWizard()}>{t("checkout", lang)} →</Button>
          </Card>
        </div>
      )}

      {wizardOpen && (
        <Modal
          title={`${t(WIZARD_STEPS[Math.min(step, WIZARD_STEPS.length - 1)], lang)} · ${t("checkout", lang)}`}
          onClose={step === SUCCESS_STEP ? closeWizard : undefined}
        >
          <div className="mb-4">
            <Stepper
              steps={WIZARD_STEPS.map((key, i) => ({
                label: t(key, lang),
                state: i < step ? "done" : i === step ? "current" : "todo",
              }))}
            />
          </div>

          {/* Step 0: cart review */}
          {step === 0 && (
            <div className="space-y-3">
              {cart.length === 0 ? (
                <EmptyState icon="🧺" title={t("emptyCart", lang)} />
              ) : (
                <>
                  <ul className="divide-y divide-stone-100">
                    {cart.map((item) => (
                      <li key={item.id} className="flex items-center gap-2 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-stone-700">{item.product.name}</p>
                          <p className="text-xs text-stone-400">{formatBDT(item.product.pricePaisa, lang)}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            aria-label={t("decrQty", lang)}
                            disabled={cartBusyIds.has(item.id)}
                            onClick={() => void changeQty(item, -1)}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-stone-300 text-base font-bold text-stone-600 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 disabled:opacity-40"
                          >
                            −
                          </button>
                          <span className="w-8 text-center text-sm font-bold">{item.qty}</span>
                          <button
                            type="button"
                            aria-label={t("incrQty", lang)}
                            disabled={cartBusyIds.has(item.id)}
                            onClick={() => void changeQty(item, 1)}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-stone-300 text-base font-bold text-stone-600 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 disabled:opacity-40"
                          >
                            +
                          </button>
                        </div>
                        <button
                          type="button"
                          aria-label={`${t("removeItem", lang)} — ${item.product.name}`}
                          disabled={cartBusyIds.has(item.id)}
                          onClick={() => void removeLine(item)}
                          className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-red-500 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 disabled:opacity-40"
                        >
                          <span aria-hidden>🗑</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center justify-between border-t border-stone-100 pt-2 font-bold text-stone-800">
                    <span>{t("orderSubtotal", lang)}</span>
                    <span>{formatBDT(subtotalPaisa, lang)}</span>
                  </div>
                </>
              )}
              <div className="flex gap-2 pt-1">
                <Button variant="ghost" className="flex-1" onClick={closeWizard}>{t("cancel", lang)}</Button>
                <Button className="flex-[2]" disabled={cart.length === 0} onClick={goDelivery}>
                  {t("next", lang)} →
                </Button>
              </div>
            </div>
          )}

          {/* Step 1: delivery info (prefilled from profile where available) */}
          {step === DELIVERY_STEP && (
            <form onSubmit={submitDelivery} noValidate className="space-y-3">
              <div>
                <Label htmlFor="co-address">{t("deliveryAddressLabel", lang)}</Label>
                <Input
                  id="co-address"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder={t("addressLabel", lang)}
                  aria-invalid={Boolean(deliveryErrs.address)}
                />
                {deliveryErrs.address && <p role="alert" className="mt-1 text-xs text-red-600">{deliveryErrs.address}</p>}
              </div>
              <div>
                <Label htmlFor="co-phone">{t("phone", lang)}</Label>
                <Input
                  id="co-phone"
                  inputMode="numeric"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t("phonePlaceholder", lang)}
                  aria-invalid={Boolean(deliveryErrs.phone)}
                />
                {deliveryErrs.phone && <p role="alert" className="mt-1 text-xs text-red-600">{deliveryErrs.phone}</p>}
              </div>
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="ghost" className="flex-1" onClick={() => setStep(0)}>← {t("back", lang)}</Button>
                <Button type="submit" className="flex-[2]">{t("next", lang)} →</Button>
              </div>
            </form>
          )}

          {/* Step 2: review before creating the order */}
          {step === REVIEW_STEP && (
            <div className="space-y-3">
              <ul className="divide-y divide-stone-100 text-sm">
                {cart.map((item) => (
                  <li key={item.id} className="flex justify-between py-2 text-stone-600">
                    <span>{item.product.name} × {item.qty}</span>
                    <span>{formatBDT(item.product.pricePaisa * item.qty, lang)}</span>
                  </li>
                ))}
              </ul>
              <div className="rounded-lg bg-stone-50 px-3 py-2 text-sm">
                <p className="text-stone-600"><span aria-hidden>📍</span> {address}</p>
                <p className="text-stone-600"><span aria-hidden>📞</span> {phone}</p>
              </div>
              <div className="flex items-center justify-between font-bold text-stone-800">
                <span>{t("orderSubtotal", lang)}</span>
                <span>{formatBDT(subtotalPaisa, lang)}</span>
              </div>
              <div className="flex gap-2 pt-1">
                <Button variant="ghost" className="flex-1" onClick={() => setStep(DELIVERY_STEP)}>← {t("back", lang)}</Button>
                <Button className="flex-[2]" loading={placing} onClick={() => void placeOrder()}>
                  {t("checkoutPlaceOrder", lang)}
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: pay — breakdown uses REAL fields from the order response */}
          {step === PAY_STEP && order && (
            <div className="space-y-3">
              <dl className="space-y-1.5 rounded-lg bg-stone-50 p-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-stone-500">{t("orderSubtotal", lang)}</dt>
                  <dd className="font-medium">{formatBDT(order.subtotalPaisa, lang)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-stone-500">{t("orderDiscount", lang)}</dt>
                  <dd className="font-medium text-green-700">−{formatBDT(order.discountPaisa, lang)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-stone-500">{t("orderDeliveryFee", lang)}</dt>
                  <dd className="font-medium">{order.deliveryFeePaisa === 0 ? t("freeLabel", lang) : formatBDT(order.deliveryFeePaisa, lang)}</dd>
                </div>
                <div className="flex justify-between border-t border-stone-200 pt-1.5 text-base">
                  <dt className="font-bold">{t("netPayable", lang)}</dt>
                  <dd className="font-bold text-green-800">{formatBDT(order.totalPaisa, lang)}</dd>
                </div>
              </dl>
              {!paid && (
                <Button size="lg" className="w-full" loading={paying} onClick={() => void pay()}>
                  {t("payNow", lang)}
                </Button>
              )}
              <p className="text-[11px] leading-relaxed text-stone-400">{t("sandboxPaymentNote", lang)}</p>
              <Button variant="ghost" className="w-full" onClick={closeWizard}>{t("close", lang)}</Button>
            </div>
          )}

          {/* Step 4: success */}
          {step === SUCCESS_STEP && order && (
            <div className="space-y-3 py-2 text-center">
              <div className="text-4xl" aria-hidden>{paid ? "✅" : "📦"}</div>
              <h3 className="text-base font-bold text-green-800">
                {paid ? t("paymentSuccessTitle", lang) : t("checkoutOrderPlaced", lang)}
              </h3>
              <p className="text-sm text-stone-600">{t("checkoutOrderNo", lang, { no: order.orderNo })}</p>
              {!paid && <p className="text-xs text-stone-400">{t("paymentPendingNote", lang)}</p>}
              <p className="text-sm font-bold text-stone-700">{t("netPayable", lang)}: {formatBDT(order.totalPaisa, lang)}</p>
              <Button className="w-full" onClick={closeWizard}>{t("done", lang)}</Button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
