// Zod contracts for critical API responses — will replace `json.data as T` casts.
// Not yet wired into `lib/api.ts`; intended as the single source of truth for
// frontend response validation (Phase 7 frontend reliability).
// Each schema mirrors the backend Prisma / route shapes and is intentionally
// permissive on extra fields (passthrough) while strict on required ones.

import { z } from "zod";

// ── Shared primitives ──
export const LangSchema = z.enum(["bn", "en"]);
export type Lang = z.infer<typeof LangSchema>;

export const IdSchema = z.string().min(1);
export const IsoDateSchema = z.coerce.date();
export const DateStringSchema = z.string().datetime({ offset: true }).or(z.string()).transform((v) => new Date(v as string));

// Allow unknown extra keys on API objects — backend may add fields without breaking frontend.
// Use .passthrough() so additional keys are retained.
function passthroughObject<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).passthrough();
}

// ── Envelope ──
export const ApiErrorDetailSchema = passthroughObject({
  code: z.string().optional(),
  message: z.string().optional(),
  details: z.unknown().optional(),
  reference: z.string().optional(),
});

export const ApiErrorEnvelopeSchema = z.object({
  ok: z.literal(false).optional(),
  error: ApiErrorDetailSchema.optional(),
});

export const ApiOkEnvelopeSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    ok: z.boolean().optional(),
    data: dataSchema,
    error: z.undefined().optional(),
  });

export const EnvelopeSchema = z.object({
  ok: z.boolean().optional(),
  data: z.unknown().optional(),
  error: z
    .object({
      code: z.string().optional(),
      message: z.string().optional(),
      details: z.unknown().optional(),
      reference: z.string().optional(),
    })
    .optional(),
});

// Helper to parse and return typed data, or throw ZodError
export function parseEnvelopeData<T extends z.ZodTypeAny>(raw: unknown, dataSchema: T): z.infer<T> {
  const env = EnvelopeSchema.parse(raw);
  if (!env.ok && env.ok !== undefined && env.error) {
    // still try to validate data if present
  }
  return dataSchema.parse(env.data);
}

// ── Auth / me ──
// Backend: GET /auth/me selects id, fullName, phone, email, role, langPref, status, phoneVerified, region, createdAt, farmerProfile, wallet
export const FarmerProfileSchema = passthroughObject({
  membershipTier: z.string().default("BRONZE"),
  membershipExpiresAt: z.coerce.date().nullable().optional(),
  district: z.string().nullable().optional(),
  upazila: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  joinedAt: z.coerce.date().optional(),
});

export const WalletBriefSchema = passthroughObject({
  balancePaisa: z.number().int(),
});

export const AuthMeSchema = passthroughObject({
  id: IdSchema,
  fullName: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().nullable().optional(),
  role: z.string().min(1),
  langPref: LangSchema,
  status: z.string().optional(),
  phoneVerified: z.boolean().optional(),
  region: z.string().nullable().optional(),
  createdAt: z.coerce.date().optional(),
  farmerProfile: FarmerProfileSchema.nullable().optional(),
  wallet: WalletBriefSchema.nullable().optional(),
});
export type AuthMe = z.infer<typeof AuthMeSchema>;

// Minimal shape used by session.tsx (subset of AuthMe) — backwards compatible
export const SessionUserSchema = passthroughObject({
  id: IdSchema,
  fullName: z.string().min(1),
  role: z.string().min(1),
  langPref: LangSchema,
});
export type SessionUser = z.infer<typeof SessionUserSchema>;

// Auth token pair returned by /auth/login, /auth/register, /auth/refresh
export const AuthTokensSchema = passthroughObject({
  accessToken: z.string().min(10),
  refreshToken: z.string().min(10),
  user: SessionUserSchema.optional(),
});
export type AuthTokens = z.infer<typeof AuthTokensSchema>;

// ── Farm ──
export const PlotSchema = passthroughObject({
  id: IdSchema,
  farmId: IdSchema,
  name: z.string().min(1),
  areaBigha: z.number().positive(),
  soilType: z.string().nullable().optional(),
  irrigationType: z.string().nullable().optional(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});
export type Plot = z.infer<typeof PlotSchema>;

export const CropCycleSchema = passthroughObject({
  id: IdSchema,
  plotId: IdSchema,
  cropName: z.string().min(1),
  variety: z.string().nullable().optional(),
  plantedAt: z.coerce.date(),
  expectedHarvestAt: z.coerce.date().nullable().optional(),
  stage: z.enum(["SEED", "GERMINATION", "VEGETATIVE", "FLOWERING", "GRAIN_FRUIT_DEVELOPMENT", "HARVEST"]),
  status: z.enum(["ACTIVE", "HARVESTED", "FAILED"]).default("ACTIVE"),
  yieldKg: z.number().nullable().optional(),
});

export const FarmSchema = passthroughObject({
  id: IdSchema,
  ownerId: IdSchema,
  organizationId: z.string().nullable().optional(),
  name: z.string().min(2),
  address: z.string().nullable().optional(),
  district: z.string().nullable().optional(),
  upazila: z.string().nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  totalAreaBigha: z.number().positive().nullable().optional(),
  status: z.string().default("ACTIVE"),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
  plots: z.array(PlotSchema).optional(),
  _count: z.object({ plots: z.number().int() }).optional(),
  organization: z.object({ id: IdSchema, name: z.string(), type: z.string() }).nullable().optional(),
});
export type Farm = z.infer<typeof FarmSchema>;

export const FarmListSchema = z.array(FarmSchema);
export type FarmList = z.infer<typeof FarmListSchema>;

// Plot list response for GET /farms/:id/plots
export const PlotListSchema = z.array(PlotSchema);

// ── Product / marketplace ──
export const ProductCategorySchema = z.enum(["SEED", "FERTILIZER", "BIO_INPUT", "CROP_PROTECTION", "EQUIPMENT"]);

export const ProductSchema = passthroughObject({
  id: IdSchema,
  sku: z.string().min(2),
  name: z.string().min(1),
  category: ProductCategorySchema.or(z.string()),
  description: z.string().nullable().optional(),
  unit: z.string().default("KG"),
  pricePaisa: z.number().int().positive(),
  stockQty: z.number().int().min(0),
  batchNo: z.string().nullable().optional(),
  expiryDate: z.coerce.date().nullable().optional(),
  supplier: z.string().nullable().optional(),
  cropRelevance: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});
export type Product = z.infer<typeof ProductSchema>;

export const ProductListEnvelopeSchema = passthroughObject({
  items: z.array(ProductSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(1),
});
export type ProductListEnvelope = z.infer<typeof ProductListEnvelopeSchema>;

// Cart — used by marketplace checkout
export const CartItemSchema = passthroughObject({
  id: IdSchema,
  cartId: IdSchema,
  productId: IdSchema,
  qty: z.number().int().positive(),
  product: ProductSchema.optional(),
});

export const CartSchema = passthroughObject({
  id: IdSchema,
  userId: IdSchema,
  items: z.array(CartItemSchema),
  subtotalPaisa: z.number().int().min(0).optional(),
});
export type Cart = z.infer<typeof CartSchema>;

// Order
export const OrderStatusSchema = z.enum(["PENDING", "CONFIRMED", "PAID", "SHIPPED", "DELIVERED", "CANCELLED", "REFUNDED"]);
export const PaymentStatusSchema = z.enum(["UNPAID", "PAID", "REFUNDED"]);

export const OrderItemSchema = passthroughObject({
  id: IdSchema,
  orderId: IdSchema,
  productId: IdSchema,
  nameSnapshot: z.string(),
  skuSnapshot: z.string(),
  unitPricePaisa: z.number().int(),
  qty: z.number().int().positive(),
});

export const OrderSchema = passthroughObject({
  id: IdSchema,
  orderNo: z.string().min(1),
  userId: IdSchema,
  status: OrderStatusSchema.or(z.string()),
  subtotalPaisa: z.number().int(),
  discountPaisa: z.number().int(),
  deliveryFeePaisa: z.number().int(),
  totalPaisa: z.number().int(),
  paymentStatus: PaymentStatusSchema.or(z.string()),
  shippingName: z.string().nullable().optional(),
  shippingPhone: z.string().nullable().optional(),
  shippingAddress: z.string().nullable().optional(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
  items: z.array(OrderItemSchema).optional(),
});
export type Order = z.infer<typeof OrderSchema>;

// ── Payment ──
export const PaymentPurposeTypeSchema = z.enum(["ORDER", "BOOKING", "PROCUREMENT", "MEMBERSHIP"]);

export const PaymentIntentResponseSchema = passthroughObject({
  paymentId: IdSchema,
  refNo: z.string().min(1),
  amountPaisa: z.number().int().positive(),
  providerMode: z.string().optional(),
  messageBn: z.string().optional(),
  messageEn: z.string().optional(),
});
export type PaymentIntentResponse = z.infer<typeof PaymentIntentResponseSchema>;

export const PaymentSchema = passthroughObject({
  id: IdSchema,
  refNo: z.string().min(1),
  userId: IdSchema,
  purposeType: PaymentPurposeTypeSchema.or(z.string()),
  purposeId: IdSchema,
  amountPaisa: z.number().int(),
  method: z.string(),
  providerRef: z.string().nullable().optional(),
  status: z.enum(["PENDING", "SUCCEEDED", "FAILED", "REFUNDED"]).or(z.string()),
  refundedAt: z.coerce.date().nullable().optional(),
  refundRef: z.string().nullable().optional(),
  metaStr: z.string().nullable().optional(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});
export type Payment = z.infer<typeof PaymentSchema>;

// Wallet summary — GET /wallet/summary
export const WalletSummarySchema = passthroughObject({
  monthCreditsPaisa: z.number().int().min(0),
  monthDebitsPaisa: z.number().int().min(0),
  pendingWithdrawalsPaisa: z.number().int().min(0),
  membership: z
    .object({
      tier: z.string().optional(),
      expiresAt: z.coerce.date().nullable().optional(),
      discountPct: z.number().int().optional(),
    })
    .nullable()
    .optional(),
});
export type WalletSummary = z.infer<typeof WalletSummarySchema>;

export const WalletSchema = passthroughObject({
  balancePaisa: z.number().int(),
  transactions: z
    .array(
      passthroughObject({
        id: IdSchema,
        userId: IdSchema,
        direction: z.enum(["CREDIT", "DEBIT"]),
        amountPaisa: z.number().int(),
        reason: z.string(),
        balanceAfterPaisa: z.number().int(),
        refType: z.string().nullable().optional(),
        refId: z.string().nullable().optional(),
        createdAt: z.coerce.date().optional(),
      })
    )
    .optional(),
});
export type Wallet = z.infer<typeof WalletSchema>;

// ── Farm events (offline queue payload) ──
export const FarmEventTypeSchema = z.enum([
  "PLANTING",
  "SEED",
  "FERTILIZER",
  "IRRIGATION",
  "PEST",
  "DISEASE",
  "SERVICE",
  "HARVEST",
  "OTHER",
]);

export const FarmEventSchema = passthroughObject({
  id: IdSchema,
  clientUuid: z.string().uuid().nullable().optional(),
  farmId: IdSchema,
  plotId: z.string().nullable().optional(),
  cropCycleId: z.string().nullable().optional(),
  actorId: IdSchema,
  type: FarmEventTypeSchema.or(z.string()),
  title: z.string().min(2),
  notes: z.string().nullable().optional(),
  metadataStr: z.string().nullable().optional(),
  occurredAt: z.coerce.date(),
  source: z.string().default("APP"),
  createdAt: z.coerce.date().optional(),
});
export type FarmEvent = z.infer<typeof FarmEventSchema>;

// ── Convenience: typed envelope parsers to replace `json.data as T` ──
export function parseAuthMe(data: unknown): AuthMe {
  return AuthMeSchema.parse(data);
}
export function parseFarm(data: unknown): Farm {
  return FarmSchema.parse(data);
}
export function parseFarmList(data: unknown): FarmList {
  return FarmListSchema.parse(data);
}
export function parseProduct(data: unknown): Product {
  return ProductSchema.parse(data);
}
export function parseProductList(data: unknown): ProductListEnvelope {
  return ProductListEnvelopeSchema.parse(data);
}
export function parsePaymentIntent(data: unknown): PaymentIntentResponse {
  return PaymentIntentResponseSchema.parse(data);
}
export function parsePayment(data: unknown): Payment {
  return PaymentSchema.parse(data);
}
export function parseWalletSummary(data: unknown): WalletSummary {
  return WalletSummarySchema.parse(data);
}
