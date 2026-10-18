/**
 * The API contract, in one place.
 *
 * Why this file exists: response shapes used to be declared inline in each feature
 * (`interface Order` in two files with different fields, `Farm` twice, the user type
 * three times). Hand-copied contracts drift silently, and the drift is invisible to
 * the compiler — an order-history screen read `item.product.name` for months while
 * the API sent `nameSnapshot`, and the page crashed only when a user expanded an
 * order.
 *
 * Rules for this file:
 *  - Every field here was read off the API route that produces it (Prisma `select` /
 *    `include` / object literal), not off a feature that consumes it.
 *  - Fields are typed as the API sends them **today**, including the asymmetries that
 *    look like mistakes but are real: `GET /orders/:id` includes `user.fullName` but
 *    not `user.phone`; `POST /cart/items` has no `subtotalPaisa`; the product list
 *    omits `isActive`/`batchNo`/timestamps.
 *  - Status/role/stage fields are `string`, not literal unions: the database columns
 *    are plain strings with no constraint, so a union would be a lie that breaks on
 *    the first legacy row. Helpers in `lib/labels.ts` turn them into display text.
 *  - Changing the API without changing this file is caught by
 *    `apps/api/tests/response-contract.test.ts`, which asserts the live response key
 *    sets against `contracts/api-response-shapes.json`. That test failing means:
 *    update the fixture, this file, and the API consumer together — in one PR.
 */

/** `ok()` envelope from apps/api/src/middleware/context.ts. */
export interface ApiEnvelope<T> {
  ok: true;
  data: T;
  requestId: string;
}

/**
 * `fail()` envelope. Note: rate-limiter rejections (429) return only
 * `{ ok:false, error:{ code, message } }` — no `requestId`, no `reference`.
 */
export interface ApiErrorEnvelope {
  ok?: false;
  error?: { code?: string; message?: string; details?: unknown; reference?: string };
  requestId?: string;
}

/** ISO-8601 date-time string as serialized by Prisma. */
export type IsoDateTime = string;
/** ISO `YYYY-MM-DD`. */
export type IsoDate = string;

/* ────────────────────────────── identity ────────────────────────────── */

/** POST /auth/login (200) · POST /auth/register (201) — `data`. */
export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    fullName: string;
    role: string;
    langPref: string;
  };
}

/** GET /auth/me — `data`. `farmerProfile`/`wallet` are optional relations. */
export interface Me {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  role: string;
  langPref: string;
  status: string;
  phoneVerified: boolean;
  region: string | null;
  createdAt: IsoDateTime;
  farmerProfile: {
    membershipTier: string;
    membershipExpiresAt: IsoDateTime | null;
    district: string | null;
    upazila: string | null;
    address: string | null;
    joinedAt: IsoDateTime;
  } | null;
  wallet: { balancePaisa: number } | null;
}

/** PATCH /auth/me — `data`. Returns the updated user plus the full profile row. */
export interface ProfileUpdateResult {
  id: string;
  fullName: string;
  email: string | null;
  langPref: string;
  role: string;
  farmerProfile: {
    id: string;
    userId: string;
    nidLast4: string | null;
    address: string | null;
    district: string | null;
    upazila: string | null;
    membershipTier: string;
    membershipExpiresAt: IsoDateTime | null;
    joinedAt: IsoDateTime;
  } | null;
}

/** POST /auth/otp/request — `data`. `devCode` is present only outside production. */
export interface OtpRequestResult {
  sent: boolean;
  expiresInMinutes?: number;
  devCode?: string;
}

export interface NotificationPreferences {
  critical: boolean;
  action: boolean;
  info: boolean;
}

/* ──────────────────────────────── farm ──────────────────────────────── */

export interface CropCycle {
  id: string;
  plotId: string;
  cropName: string;
  variety: string | null;
  plantedAt: IsoDateTime;
  expectedHarvestAt: IsoDateTime | null;
  /** SEED | GERMINATION | VEGETATIVE | FLOWERING | GRAIN_FRUIT_DEVELOPMENT | HARVEST */
  stage: string;
  /** ACTIVE | HARVESTED | FAILED */
  status: string;
  yieldKg: number | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Plot {
  id: string;
  farmId: string;
  name: string;
  areaBigha: number;
  soilType: string | null;
  irrigationType: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/**
 * GET /farms — element of `data`.
 * `plots[].cropCycles` is a **reduced, server-filtered** projection (ACTIVE cycles
 * only, five fields) — not the `CropCycle` model. That filter is deliberate: the
 * dashboard counts active crops from it.
 */
export interface FarmListItem {
  id: string;
  ownerId: string;
  organizationId: string | null;
  name: string;
  address: string | null;
  district: string | null;
  upazila: string | null;
  lat: number | null;
  lng: number | null;
  totalAreaBigha: number | null;
  status: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  plots: {
    id: string;
    name: string;
    areaBigha: number;
    soilType: string | null;
    irrigationType: string | null;
    cropCycles: { id: string; cropName: string; stage: string; plantedAt: IsoDateTime; status: string }[];
  }[];
  _count: { plots: number };
  organization: { id: string; name: string; type: string } | null;
}

/** GET /farms/:id/plots — element of `data` (full cycles, unfiltered here). */
export interface FarmPlot extends Plot {
  cropCycles: CropCycle[];
}

/** GET /farms/crops — element of `data`. */
export interface CropListItem extends CropCycle {
  plot: { name: string; farm: { name: string } };
  /** Recomputed from `plantedAt`; may differ from the stored `stage`. */
  stageAuto: string;
  /** Derived from the **stored** stage. */
  calendar: { taskEn: string; taskBn: string; dueDays: number }[];
}

/* ─────────────────────────────── weather ─────────────────────────────── */

export type WeatherRiskType =
  | "SPRAY_WARNING"
  | "RAIN_WARNING"
  | "HEAT_WARNING"
  | "IRRIGATION_ADVICE"
  | "DISEASE_RISK"
  | "INFO";

export interface WeatherAdvisory {
  type: WeatherRiskType;
  severity: "LOW" | "MODERATE" | "HIGH";
  titleBn: string;
  titleEn: string;
  detailEn: string;
}

/** GET /weather — `data`. `forecast` length is provider-dependent (3 requested). */
export interface WeatherData {
  provider: string;
  current: {
    tempC: number;
    feelsLikeC: number;
    humidityPct: number;
    windKmh: number;
    precipitationMm: number;
    condition: string;
  };
  forecast: {
    date: IsoDate;
    minC: number;
    maxC: number;
    rainMm: number;
    humidityPct: number;
    windKmh: number;
  }[];
  /** Never empty — an INFO/LOW entry is pushed when nothing else applies. */
  risks: WeatherAdvisory[];
}

/* ─────────────────────────────── AI agent ─────────────────────────────── */

/** POST /ai/advisory — `data`. Token counts only exist for the hosted provider. */
export interface AdvisoryAnswer {
  answer: string;
  confidence: number;
  provider: string;
  model: string;
  lowConfidenceFlag: boolean;
  groundedRefs: string[];
  tokensIn?: number;
  tokensOut?: number;
}

/**
 * GET /ai/history — element of `data`. No provider/model are returned.
 * `groundedRefs` lists only KB references that still exist at read time;
 * entries removed since the answer was stored are dropped by the server.
 */
export interface AdvisoryHistoryItem {
  id: string;
  question: string;
  answer: string;
  confidence: number;
  lowConfidenceFlag: boolean;
  groundedRefs: string[];
  createdAt: IsoDateTime;
}

/** POST /disease/cases (201) and GET /disease/cases element. */
export interface DiseaseCase {
  id: string;
  userId: string;
  cropCycleId: string | null;
  imagePath: string;
  cropGuess: string | null;
  diagnosis: string | null;
  confidence: number | null;
  severity: string | null;
  recommendation: string | null;
  /** PENDING_REVIEW | REVIEWED | … */
  status: string;
  reviewedBy: string | null;
  reviewedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

/* ───────────────────────────── marketplace ───────────────────────────── */

/** GET /products — element of `data.items` (a projection, not the full model). */
export interface ProductListItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  description: string | null;
  unit: string;
  pricePaisa: number;
  stockQty: number;
  supplier: string | null;
  cropRelevance: string | null;
  expiryDate: IsoDateTime | null;
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type ProductList = Paged<ProductListItem>;

/** Cart line. `product` here **is** the full product record. */
export interface CartLine {
  id: string;
  cartId: string;
  productId: string;
  qty: number;
  product: {
    id: string;
    sku: string;
    name: string;
    category: string;
    description: string | null;
    unit: string;
    pricePaisa: number;
    stockQty: number;
    batchNo: string | null;
    expiryDate: IsoDateTime | null;
    supplier: string | null;
    cropRelevance: string | null;
    isActive: boolean;
    createdAt: IsoDateTime;
    updatedAt: IsoDateTime;
  };
}

/** GET /cart — `data`. POST /cart/items returns the same shape **without** `subtotalPaisa`. */
export interface Cart {
  id: string;
  userId: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  items: CartLine[];
  subtotalPaisa: number;
}

export type CartAfterAdd = Omit<Cart, "subtotalPaisa">;

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  /** Immutable snapshot taken at checkout — render this, never the live product. */
  nameSnapshot: string;
  skuSnapshot: string;
  unitPricePaisa: number;
  qty: number;
}

export interface Order {
  id: string;
  orderNo: string;
  userId: string;
  /** PENDING | CONFIRMED | PAID | SHIPPED | DELIVERED | CANCELLED */
  status: string;
  subtotalPaisa: number;
  discountPaisa: number;
  deliveryFeePaisa: number;
  totalPaisa: number;
  /** UNPAID | PAID | REFUNDED */
  paymentStatus: string;
  shippingName: string | null;
  shippingPhone: string | null;
  shippingAddress: string | null;
  cancelReason: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** GET /orders and GET /orders/:id — the list includes `user.phone`, the detail does not. */
export interface OrderWithItems extends Order {
  items: OrderItem[];
  user: { fullName: string; phone?: string };
}

/* ────────────────────────── services & bookings ────────────────────────── */

export interface ServiceWithProviders {
  id: string;
  code: string;
  name: string;
  category: string;
  basePricePaisa: number;
  priceUnit: string;
  description: string | null;
  isActive: boolean;
  providers: { id: string; name: string; district: string | null; ratingSum: number; ratingCount: number }[];
}

export interface Booking {
  id: string;
  bookingNo: string;
  userId: string;
  farmId: string;
  serviceId: string;
  providerId: string | null;
  scheduledFor: IsoDateTime;
  areaBigha: number;
  estimatedPricePaisa: number;
  /** REQUESTED | ASSIGNED | COMPLETED | CANCELLED */
  status: string;
  paymentStatus: string;
  rating: number | null;
  cancelReason: string | null;
  completedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface BookingWithRelations extends Booking {
  service: { name: string; category: string };
  farm: { name: string };
  provider: { name: string } | null;
}

/* ───────────────────────────── procurement ───────────────────────────── */

export interface ProcurementOrder {
  id: string;
  poNo: string;
  userId: string;
  farmId: string;
  cropName: string;
  quantityKg: number;
  moisturePct: number | null;
  qualityGrade: string | null;
  basePricePerKgPaisa: number;
  deductionsPaisa: number;
  netPayablePaisa: number;
  /** SUBMITTED | QC | PURCHASE_ORDER | COLLECTED | PAID | REJECTED */
  status: string;
  notes: string | null;
  qcNotes: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** POST /procurement/offers — `data`. */
export interface ProcurementOfferResult extends ProcurementOrder {
  calculation: { grossPaisa: number; deductionsPaisa: number; netPayablePaisa: number };
}

/** GET /procurement — element of `data`. */
export interface ProcurementListItem extends ProcurementOrder {
  farm: { name: string };
  user: { fullName: string; phone: string; region: string | null };
}

/* ─────────────────────────────── wallet ─────────────────────────────── */

export interface WalletTransaction {
  id: string;
  userId: string;
  direction: "CREDIT" | "DEBIT" | string;
  amountPaisa: number;
  reason: string;
  balanceAfterPaisa: number;
  refType: string | null;
  refId: string | null;
  createdAt: IsoDateTime;
}

/** GET /wallet — `data`. */
export interface WalletData {
  balancePaisa: number;
  transactions: WalletTransaction[];
}

/** GET /wallet/summary — `data`. */
export interface WalletSummary {
  monthCreditsPaisa: number;
  monthDebitsPaisa: number;
  pendingWithdrawalsPaisa: number;
  membership: { tier: string; expiresAt: IsoDateTime | null; discountPct: number };
}

export interface Withdrawal {
  id: string;
  refNo: string;
  userId: string;
  amountPaisa: number;
  /** PENDING | APPROVED | REJECTED | PAID */
  status: string;
  /** BKASH | NAGAD | BANK */
  channel: string;
  destination: string | null;
  note: string | null;
  decidedBy: string | null;
  decidedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Payment {
  id: string;
  refNo: string;
  userId: string;
  purposeType: string;
  purposeId: string;
  amountPaisa: number;
  method: string;
  providerRef: string | null;
  /** PENDING | SUCCEEDED | FAILED | REFUNDED */
  status: string;
  refundedAt: IsoDateTime | null;
  refundRef: string | null;
  metaStr: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** GET /payments — element of `data`. */
export interface PaymentListItem extends Payment {
  user: { fullName: string };
}

/** GET /membership/plans — element of `data` (public endpoint, no auth required). */
export interface MembershipPlan {
  id: string;
  tier: string;
  pricePaisa: number;
  durationDays: number;
  benefitsStr: string;
  benefits: string[];
  isActive: boolean;
}

/** POST /payments/intent — `data`. `redirectUrl` appears only with a live gateway. */
export interface PaymentIntent {
  paymentId: string;
  refNo: string;
  amountPaisa: number;
  providerMode: string;
  redirectUrl?: string;
  messageBn?: string;
  messageEn?: string;
}

/** GET /payments/:id/status — `data`. */
export interface PaymentStatus {
  status: string;
  reconciled: boolean;
  providerMode?: string;
  providerVerdict?: "SUCCEEDED" | "FAILED" | "PENDING";
}

/* ───────────────────────────── notifications ───────────────────────────── */

export interface AppNotification {
  id: string;
  userId: string;
  type: string;
  /** CRITICAL | ACTION | INFO */
  category: string;
  title: string;
  body: string;
  readAt: IsoDateTime | null;
  refType: string | null;
  refId: string | null;
  createdAt: IsoDateTime;
}

/**
 * GET /notifications — `data`.
 * Careful: `unread` counts unread entries *within the returned (optionally
 * category-filtered) items*, while `counts.*` are unfiltered database counts.
 */
export interface NotificationsData {
  items: AppNotification[];
  unread: number;
  counts: { critical: number; action: number; info: number };
}

/* ──────────────────────────────── admin ──────────────────────────────── */

export interface AdminMetrics {
  farmers: number;
  activeFarmers: number;
  farms: number;
  activeCrops: number;
  orders: number;
  bookings: number;
  pendingProcurement: number;
  /** SUCCEEDED payments excluding procurement payouts. */
  revenuePaisa: number;
  aiAdvisoryQueries: number;
}

export interface AdminUser {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  role: string;
  status: string;
  /** Territorial scope; editable through PATCH /admin/users/:id, hence returned. */
  region: string | null;
  createdAt: IsoDateTime;
  farmerProfile: { membershipTier: string; district: string | null } | null;
}

export type AdminUsersData = Paged<AdminUser>;

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ip: string | null;
  metaStr: string | null;
  createdAt: IsoDateTime;
  actor: { fullName: string; role: string } | null;
}

export type AdminAuditLogsData = Paged<AuditLogEntry>;

export interface AdminAnalyticsSummary {
  windowDays: number;
  events: { name: string; count: number }[];
  activeDaysSample: number;
}

export interface AdminWithdrawalItem extends Withdrawal {
  user: { fullName: string; phone: string; phoneVerified: boolean };
}
