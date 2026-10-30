import { useEffect, useState } from "react";
import { api, setCriticalFlow, ApiError } from "../../lib/api";
import { uuid } from "../../lib/uuid";
import type { Cart, CartLine, Me, Order, PaymentIntent, ProductList, ProductListItem } from "../../lib/api-types";
import { invalidate, useResource } from "../../lib/useResource";
import { useSession } from "../../lib/session";
import { t } from "../../lib/i18n";
import type { DictKey } from "../../lib/i18n";
import { formatBDT } from "../../lib/format";
import { categoryLabel } from "../../lib/labels";
import { mapError, BD_PHONE_RE } from "../../lib/errors-ui";
import { track } from "../../lib/analytics";
import { Check, Inbox, MapPin, Package, Phone, ShieldCheck, ShoppingBasket, ShoppingCart, FlaskConical, Leaf, Sprout, Trash2, Wrench } from "lucide-react";
import {
  Badge, BlockError, Button, Card, EmptyState, ErrorBanner, IconButton, Input, Label, Modal, PageHeader, Skeleton, Stepper, useToast,
} from "../../components/ui";

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

/**
 * One checkout idempotency key per attempt, persisted so a page
 * reload or a manual/offline retry re-sends the SAME key — the server then
 * replays the already-created order instead of charging/ordering twice.
 * Cleared on success and whenever the cart is observed empty, so the next
 * checkout mints a fresh key.
 */
const PENDING_CHECKOUT_KEY = "checkout:pendingReqId";

function pendingCheckoutKey(): string {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(PENDING_CHECKOUT_KEY);
  } catch {
    /* storage blocked (private mode) — no persisted key to reuse */
  }
  if (stored) return stored;
  // `uuid()` never throws (see lib/uuid.ts). A bare `crypto.randomUUID()` here was
  // called before the caller's `try`, so on a context without it the throw skipped
  // the `finally` that clears `placing` and the Place-order button spun forever.
  const id = uuid();
  try {
    localStorage.setItem(PENDING_CHECKOUT_KEY, id);
  } catch {
    /* not persisted: still idempotent within this page's life */
  }
  return id;
}

function clearPendingCheckoutKey(): void {
  try {
    localStorage.removeItem(PENDING_CHECKOUT_KEY);
  } catch {
    /* storage blocked — nothing to clear */
  }
}

/** Category → tinted icon tile (same visual grammar as ServiceCard's AgriIconBox). */
const CATEGORY_ICON: Record<string, { icon: typeof Sprout; box: string }> = {
  SEED: { icon: Sprout, box: "bg-brand-50 text-brand-700 ring-brand-100" },
  FERTILIZER: { icon: FlaskConical, box: "bg-warning-bg text-warning-text ring-warning-border" },
  BIO_INPUT: { icon: Leaf, box: "bg-success-bg text-success-text ring-success-border" },
  CROP_PROTECTION: { icon: ShieldCheck, box: "bg-info-bg text-info-text ring-info-border" },
  EQUIPMENT: { icon: Wrench, box: "bg-warning-bg text-warning-text ring-warning-border" },
};

export default function Market() {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const toast = useToast();

  const [category, setCategory] = useState("");
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [cartBusyIds, setCartBusyIds] = useState<Set<string>>(new Set());

  // The screen reads two independent endpoints, so it holds two independent
  // resources: the catalogue and the cart each load, fail and recover on their
  // own — a failed cart fetch no longer removes the product grid, and a failed
  // catalogue no longer blanks the cart bar.
  const productsRes = useResource<ProductList>(
    "market-products",
    // The catalogue request carries the active category — unchanged: the same
    // `?pageSize=50&category=<cat>` URL, refetched when the chip changes.
    () => api<ProductList>("GET", `/products?pageSize=50${category ? `&category=${category}` : ""}`),
    [category]
  );
  const cartRes = useResource<Cart>("market-cart", () => api<Cart>("GET", "/cart"));

  const products = productsRes.data?.items ?? [];
  const cart = cartRes.data?.items ?? [];

  // Checkout wizard
  const [wizardOpen, setWizardOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [prefillDone, setPrefillDone] = useState(false);
  const [deliveryErrs, setDeliveryErrs] = useState<{ address?: string; phone?: string }>({});
  const [order, setOrder] = useState<Order | null>(null);
  const [paid, setPaid] = useState(false);
  // Server-reported provider mode from POST /payments/intent (`providerMode`).
  // Until the intent response arrives the mode is unknown, so no sandbox claim
  // is rendered — the wording appears only when the server says "sandbox".
  const [intentMode, setIntentMode] = useState<string | null>(null);
  // The intent is created with the order (not at tap time) so the payment
  // surface can disclose the REAL provider mode before the user commits.
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [placing, setPlacing] = useState(false);
  const [paying, setPaying] = useState(false);
  const [placeOrderError, setPlaceOrderError] = useState<string | null>(null);

  useEffect(() => {
    track("market_view", { category: category || "ALL" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A loaded, empty cart means any pending checkout key is spent (the order
  // consumed the cart) or obsolete — the next checkout mints a fresh one.
  // Guarded on loaded data so the pre-fetch empty state cannot wipe a key that
  // a page reload mid-checkout must reuse.
  useEffect(() => {
    if (cartRes.data && cartRes.data.items.length === 0) clearPendingCheckoutKey();
  }, [cartRes.data]);

  // Navigating away with the wizard open (route change, browser back) never
  // runs closeWizard — without this cleanup the module-level guard stayed set
  // for the tab's lifetime and api.ts swallowed every later 401: no token
  // clearing, no redirect to login, on any screen. Unmount releases it the
  // same way an explicit close does.
  useEffect(() => () => setCriticalFlow(false), []);

  function markBusy(id: string, busy: boolean) {
    setCartBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function addToCart(p: ProductListItem) {
    markBusy(p.id, true);
    try {
      await api("POST", "/cart/items", { productId: p.id, qty: 1 });
      track("product_added_to_cart", { productId: p.id });
      // The line moved the cart and nothing else; the old code awaited a cart
      // refetch, which this family invalidation triggers.
      invalidate("market-cart");
      // Instant success acknowledgment (enterprise feedback <100ms rule);
      // transient only — button returns to its at-rest label after 1.2s.
      setJustAddedId(p.id);
      window.setTimeout(() => setJustAddedId((cur) => (cur === p.id ? null : cur)), 1200);
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      markBusy(p.id, false);
    }
  }

  /** POST /cart/items upserts an ABSOLUTE qty (verified against marketplace routes). */
  async function changeQty(item: CartLine, delta: number) {
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
      invalidate("market-cart");
    } catch (err) {
      toast.error(mapError(err, lang));
    } finally {
      markBusy(item.id, false);
    }
  }

  async function removeLine(item: CartLine) {
    const productId = item.product?.id ?? item.productId;
    if (!productId) return;
    markBusy(item.id, true);
    try {
      await api("DELETE", `/cart/items/${productId}`);
      invalidate("market-cart");
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
    setIntentMode(null);
    setIntent(null);
    setDeliveryErrs({});
    setCriticalFlow(true);  // Guard: prevent session-destroy during checkout
    if (!prefillDone) {
      setPrefillDone(true);
      try {
        const me = await api<Me>("GET", "/auth/me");
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
    setCriticalFlow(false);
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
    if (placing) return;
    setPlacing(true);
    setPlaceOrderError(null);
    // Reused across retries/reloads; only cleared once the order is confirmed.
    const clientRequestId = pendingCheckoutKey();
    try {
      // The delivery details validated in step 1 must travel with the order —
      // they are what fulfilment uses, and the server rejects a malformed
      // value rather than silently dropping it.
      const recipient = session?.fullName?.trim() ?? "";
      const o = await api<Order>("POST", "/orders/checkout", {
        clientRequestId,
        ...(recipient.length >= 2 ? { shippingName: recipient } : {}),
        ...(phone.trim() ? { shippingPhone: phone.trim() } : {}),
        ...(address.trim() ? { shippingAddress: address.trim() } : {}),
      });
      // Order confirmed (created or replayed) — this key is spent.
      clearPendingCheckoutKey();
      setOrder(o);
      setStep(PAY_STEP);
      // Best-effort intent creation so the mode label is truthful BEFORE the
      // tap; a failure here leaves intent null and pay() creates it lazily.
      void api<PaymentIntent>("POST", "/payments/intent", { purposeType: "ORDER", purposeId: o.id })
        .then((i) => {
          setIntent(i);
          setIntentMode(i.providerMode);
        })
        .catch(() => null);
      // Order already created; the refresh is fire-and-forget, so a failed cart
      // reload can no longer block payment. The old code refetched the cart only.
      invalidate("market-cart");
    } catch (err) {
      const msg = mapError(err, lang);
      // CRITICAL: show inline error in the wizard so user sees WHAT went wrong
      // (toast auto-dismisses in 6s and is easy to miss during checkout)
      setPlaceOrderError(msg);
      // Also toast as fallback
      toast.error(msg);
    } finally {
      setPlacing(false);
    }
  }

  async function pay() {
    if (!order || paying) return;
    setPaying(true);
    try {
      let current = intent;
      if (!current) {
        current = await api<PaymentIntent>("POST", "/payments/intent", {
          purposeType: "ORDER",
          purposeId: order.id,
        });
        setIntent(current);
      }
      // The real mode is whatever the server reports for this deployment.
      setIntentMode(current.providerMode);

      if (current.redirectUrl) {
        // A real gateway is configured: the hosted checkout page collects the
        // money and returns the buyer to the app (POST -> API -> /orders).
        track("checkout_payment_redirect", { totalPaisa: order.totalPaisa });
        window.location.assign(current.redirectUrl);
        return;
      }

      if (current.providerMode === "sandbox") {
        await api("POST", `/payments/${current.paymentId}/confirm`);
        setPaid(true);
      }
      track("checkout_completed", { totalPaisa: order.totalPaisa });
      toast.success(t("checkoutOrderPlaced", lang));
      setStep(SUCCESS_STEP);
      // Order + payment already succeeded; the old code refetched the cart and
      // the catalogue here (stock moved), so exactly those two families are
      // invalidated — neither can block the success step.
      invalidate("market-cart");
      invalidate("market-products");
    } catch (err) {
      if (err instanceof ApiError && err.code === "PAYMENT_GATEWAY_NOT_CONFIGURED") {
        // The order exists and is genuinely unpaid — say exactly that instead
        // of reporting a payment that never happened.
        setPaid(false);
        setStep(SUCCESS_STEP);
        // Same single refetch as before on this branch — the cart, not the grid.
        invalidate("market-cart");
        return;
      }
      toast.error(mapError(err, lang));
    } finally {
      setPaying(false);
    }
  }

  // Guarded like the mutation helpers above, which already read
  // `item.product?.id ?? item.productId`: a cart line whose joined product is
  // absent (one payload shape) used to throw here, during render, and take the
  // whole marketplace to the ErrorBoundary. Integer paisa × quantity is exact, so
  // this total cannot drift from the server's.
  const subtotalPaisa = cart.reduce((s, i) => s + (i.product?.pricePaisa ?? 0) * i.qty, 0);

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader icon={<ShoppingCart className="h-5 w-5" aria-hidden />} title={t("market", lang)} />

      <div className="flex gap-2 overflow-x-auto whitespace-nowrap pb-1 sm:flex-wrap sm:overflow-visible sm:whitespace-normal">
        {CATEGORY_FILTERS.map((c) => (
          <button
            key={c.value || "all"}
            type="button"
            onClick={() => setCategory(c.value)}
            aria-pressed={category === c.value}
            className={`min-h-[44px] shrink-0 rounded-full px-4 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] focus-visible:ring-offset-2 ring-offset-[var(--color-surface-bg)] ${
              category === c.value
                ? "bg-action text-white shadow-sm"
                : "bg-surface-card text-stone-600 ring-1 ring-surface-border-strong hover:bg-brand-50 hover:text-accent"
            }`}
          >
            {t(c.key, lang)}
          </button>
        ))}
      </div>

      {/* Catalogue failure and cart failure each get their own banner and retry,
          so neither block can take the other down with it. */}
      <BlockError error={productsRes.error} retryLabel={t("retry", lang)} onRetry={() => void productsRes.reload()} />
      <BlockError error={cartRes.error} retryLabel={t("retry", lang)} onRetry={() => void cartRes.reload()} />

      {/* Each product card below is an h3, and the only heading above them is the
          page h1 — so the outline jumped a level. This hidden h2 names the
          catalogue region, the same pattern Services uses for its discovery
          section. Rendered only when there is a grid to name. */}
      {!productsRes.loading && products.length > 0 && (
        <h2 className="sr-only">{t("marketCatalogSr", lang)}</h2>
      )}

      {productsRes.loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-9 w-full" />
            </Card>
          ))}
        </div>
      ) : products.length === 0 && !productsRes.error ? (
        <EmptyState
          icon={<Inbox className="h-10 w-10 text-stone-300" aria-hidden />}
          title={t("noProducts", lang)}
          description={category ? t("marketNoProductsDesc", lang) : undefined}
          action={category ? <Button variant="outline" onClick={() => setCategory("")}>{t("catAll", lang)}</Button> : undefined}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" style={{ contentVisibility: "auto", containIntrinsicSize: "0 500px" }}>
          {products.map((p, i) => {
            const cat = CATEGORY_ICON[p.category] ?? CATEGORY_ICON.SEED;
            const Icon = cat.icon;
            return (
              <Card key={p.id} className="animate-enterprise flex min-w-0 flex-col justify-between overflow-hidden" style={{ animationDelay: `${Math.min(i, 8) * 60}ms` } as React.CSSProperties}>
                <div>
                  <div className="mb-2.5 flex items-start justify-between gap-2">
                    <span aria-hidden className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-iconBox ring-1 ring-inset ${cat.box}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <Badge tone="outline" className="shrink-0">{categoryLabel(p.category, lang)}</Badge>
                  </div>
                  <h3 className="break-words text-sm font-bold leading-snug text-stone-800 [overflow-wrap:anywhere]">{p.name}</h3>
                  <p className="mt-1.5 text-lg font-bold tabular-nums text-accent">
                    {formatBDT(p.pricePaisa, lang)} <span className="text-xs font-normal text-stone-500">/ {p.unit}</span>
                  </p>
                  <p className={`mt-0.5 text-xs ${p.stockQty > 0 ? "text-stone-500" : "font-semibold text-danger-text"}`}>
                    {p.stockQty > 0 ? t("stockLeft", lang, { n: p.stockQty }) : t("outOfStock", lang)}
                  </p>
                </div>
                <Button variant={justAddedId === p.id ? "soft" : "primary"} className="mt-3 w-full" disabled={p.stockQty === 0} loading={cartBusyIds.has(p.id)} onClick={() => void addToCart(p)}>
                  {justAddedId === p.id ? <><Check className="h-4 w-4" aria-hidden /> {t("addedToCart", lang)}</> : <>+ {t("addToCart", lang)}</>}
                </Button>
              </Card>
            );
          })}
        </div>
      )}

      {/* Sticky cart bar: safe-area aware, clears the mobile BottomNav */}
      {cart.length > 0 && !wizardOpen && (
        <div className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 md:bottom-[calc(1rem+env(safe-area-inset-bottom))]">
          <Card className="flex items-center justify-between gap-3 border-brand-200 ring-1 ring-brand-100">
            <p aria-live="polite" aria-atomic="true" className="text-sm font-semibold text-stone-700">
              <ShoppingBasket className="mr-1 inline h-5 w-5" aria-hidden /> {t("cartItemsCount", lang, { n: cart.length })} · {formatBDT(subtotalPaisa, lang)}
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
                <EmptyState headingLevel={3} icon={<Inbox className="h-10 w-10 text-stone-300" aria-hidden />} title={t("emptyCart", lang)} />
              ) : (
                <>
                  <ul className="divide-y divide-stone-100">
                    {cart.map((item) => (
                      <li key={item.id} className="flex items-center gap-2 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="break-words text-sm font-medium text-stone-700 [overflow-wrap:anywhere]">{item.product.name}</p>
                          <p className="text-xs text-stone-500">{formatBDT(item.product.pricePaisa, lang)}</p>
                        </div>
                        <div className="flex items-center gap-1">
                          <IconButton variant="outline" label={t("decrQty", lang)} disabled={cartBusyIds.has(item.id)} onClick={() => void changeQty(item, -1)}>
                            −
                          </IconButton>
                          <span className="w-8 text-center text-sm font-bold">{item.qty}</span>
                          <IconButton variant="outline" label={t("incrQty", lang)} disabled={cartBusyIds.has(item.id)} onClick={() => void changeQty(item, 1)}>
                            +
                          </IconButton>
                        </div>
                        <IconButton
                          variant="ghost"
                          label={`${t("removeItem", lang)} — ${item.product.name}`}
                          disabled={cartBusyIds.has(item.id)}
                          onClick={() => void removeLine(item)}
                          className="text-danger-text hover:bg-danger-bg"
                        >
                          <Trash2 className="h-5 w-5" aria-hidden />
                        </IconButton>
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
                  autoComplete="street-address"
                  value={address}
                  onChange={(e) => { setAddress(e.target.value); setDeliveryErrs((prev) => ({ ...prev, address: undefined })); }}
                  onBlur={() => { if (address.trim().length > 0 && address.trim().length < 5) setDeliveryErrs((prev) => ({ ...prev, address: t("errFieldRequired", lang) })); }}
                  placeholder={t("addressLabel", lang)}
                  aria-invalid={Boolean(deliveryErrs.address)}
                  aria-describedby={deliveryErrs.address ? "co-address-err" : undefined}
                />
                {deliveryErrs.address && <p id="co-address-err" role="alert" className="mt-1 text-xs text-danger-text">{deliveryErrs.address}</p>}
              </div>
              <div>
                <Label htmlFor="co-phone">{t("phone", lang)}</Label>
                <Input
                  id="co-phone"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => { setPhone(e.target.value); setDeliveryErrs((prev) => ({ ...prev, phone: undefined })); }}
                  onBlur={() => { if (phone.trim() && !BD_PHONE_RE.test(phone.trim())) setDeliveryErrs((prev) => ({ ...prev, phone: t("errPhoneInvalid", lang) })); }}
                  placeholder={t("phonePlaceholder", lang)}
                  aria-invalid={Boolean(deliveryErrs.phone)}
                  aria-describedby={deliveryErrs.phone ? "co-phone-err" : undefined}
                />
                {deliveryErrs.phone && <p id="co-phone-err" role="alert" className="mt-1 text-xs text-danger-text">{deliveryErrs.phone}</p>}
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
              {placeOrderError && (
                // No `code`: the raw envelope identifier is not user content.
                <ErrorBanner message={placeOrderError} />
              )}
              <ul className="divide-y divide-stone-100 text-sm">
                {cart.map((item) => (
                  <li key={item.id} className="flex justify-between py-2 text-stone-600">
                    <span className="break-words [overflow-wrap:anywhere]">{item.product.name} × {item.qty}</span>
                    <span>{formatBDT(item.product.pricePaisa * item.qty, lang)}</span>
                  </li>
                ))}
              </ul>
              <div className="rounded-lg bg-stone-50 px-3 py-2 text-sm">
                <p className="flex items-center gap-2 break-words text-stone-600 [overflow-wrap:anywhere]"><MapPin className="h-4 w-4 shrink-0 text-stone-400" aria-hidden /> <span className="min-w-0 break-words [overflow-wrap:anywhere]">{address}</span></p>
                <p className="flex items-center gap-2 break-all text-stone-600"><Phone className="h-4 w-4 shrink-0 text-stone-400" aria-hidden /> <span className="break-all">{phone}</span></p>
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
                  <dt className="text-stone-600">{t("orderSubtotal", lang)}</dt>
                  <dd className="font-medium">{formatBDT(order.subtotalPaisa, lang)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-stone-600">{t("orderDiscount", lang)}</dt>
                  <dd className="font-medium text-success-text">−{formatBDT(order.discountPaisa, lang)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-stone-600">{t("orderDeliveryFee", lang)}</dt>
                  <dd className="font-medium">{order.deliveryFeePaisa === 0 ? t("freeLabel", lang) : formatBDT(order.deliveryFeePaisa, lang)}</dd>
                </div>
                <div className="flex justify-between border-t border-stone-200 pt-1.5 text-base">
                  <dt className="font-bold">{t("netPayable", lang)}</dt>
                  <dd className="font-bold text-stone-800">{formatBDT(order.totalPaisa, lang)}</dd>
                </div>
              </dl>
              {!paid && (
                <Button size="lg" className="w-full" loading={paying} onClick={() => void pay()}>
                  {t("payNow", lang)}
                </Button>
              )}
              {/* Sandbox disclosure belongs BEFORE the user commits, not only on
                  the receipt: whoever taps "Pay now" must already know no real
                  money will move (C-25 / IR-14). */}
              {!paid && intentMode === "sandbox" && (
                <p className="text-center text-xs text-stone-500">{t("sandboxPaymentNote", lang)}</p>
              )}
              <Button variant="ghost" className="w-full" onClick={closeWizard}>{t("close", lang)}</Button>
            </div>
          )}

          {/* Step 4: success */}
          {step === SUCCESS_STEP && order && (
            <div className="space-y-3 py-2 text-center">
              {paid ? <Check className="mx-auto h-10 w-10 text-success-text" aria-hidden /> : <Package className="mx-auto h-10 w-10 text-stone-400" aria-hidden />}
              <h3 className="text-base font-bold text-success-text">
                {paid ? t("paymentSuccessTitle", lang) : t("checkoutOrderPlaced", lang)}
              </h3>
              <p className="break-all text-sm text-stone-600 [overflow-wrap:anywhere]">{t("checkoutOrderNo", lang, { no: order.orderNo })}</p>
              {!paid && <p className="text-xs text-stone-500">{t("paymentPendingNote", lang)}</p>}
              {/* Sandbox wording only when the server reported sandbox mode. */}
              {paid && intentMode === "sandbox" && <p className="text-xs text-stone-500">{t("sandboxPaymentNote", lang)}</p>}
              <p className="text-sm font-bold text-stone-700">{t("netPayable", lang)}: {formatBDT(order.totalPaisa, lang)}</p>
              <Button className="w-full" onClick={closeWizard}>{t("done", lang)}</Button>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
