import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { notFound, badRequest, unprocessable, conflict } from "../../shared/errors/index.js";
import { ok, idempotencyKeyOf } from "../../middleware/context.js";
import { getActiveMembership } from "../../lib/membership.js";
import { audit } from "../../middleware/audit.js";
import { notify } from "../../providers/notification/service.js";
import { refNo, orderTotals } from "../../lib/money.js";
import { env } from "../../config/env.js";
import { createRedisStore } from "../../lib/rateLimitRedis.js";
import { rateLimitHandler } from "../../middleware/rateLimitResponse.js";
import { userOrIpKey } from "../../middleware/rateLimitKeys.js";
import { acceptIdempotencyKeyHeader } from "../../middleware/idempotency.js";
import { getAuth } from "../../shared/auth-context.js";
import { ciContains } from "../../shared/utils/ciContains.js";

export const productsRouter = Router();
export const cartRouter = Router();
export const ordersRouter = Router();

// Financial hot paths get stricter limits than the global one.
// Keyed by authenticated user (falls back to IP pre-auth) so one busy user
// cannot exhaust another's quota behind a shared NAT/127.0.0.1. Shared helper
// since F-04 collapsed four copies of this rule into rateLimitKeys.ts.
const checkoutStore = env.REDIS_URL ? createRedisStore(env.REDIS_URL, 15 * 60 * 1000) : undefined;
const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  store: checkoutStore,
  // Standardized 429 envelope: requestId + ok:false/error shape, with
  // this limiter's own message preserved.
  handler: rateLimitHandler,
  message: { ok: false, error: { code: "RATE_LIMITED", message: "Too many checkout attempts. Please slow down." } },
});

// ---------------- Products (marketplace catalog) ----------------
productsRouter.use(requireAuth);

const productBody = z.object({
  sku: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(160),
  category: z.enum(["SEED", "FERTILIZER", "BIO_INPUT", "CROP_PROTECTION", "EQUIPMENT"]),
  description: z.string().trim().max(2000).optional(),
  unit: z.string().trim().max(20).default("KG"),
  pricePaisa: z.number().int().positive(),
  stockQty: z.number().int().min(0).default(0),
  batchNo: z.string().trim().max(60).optional(),
  expiryDate: z.coerce.date().optional(),
  supplier: z.string().trim().max(160).optional(),
  cropRelevance: z.string().trim().max(300).optional(),
});

const listQuery = z.object({
  category: z.string().optional(),
  search: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

productsRouter.get("/", validate({ query: listQuery }), async (req, res, next) => {
  try {
    const { category, search, page, pageSize } = req.query as unknown as z.infer<typeof listQuery>;
    const where = {
      isActive: true,
      ...(category ? { category } : {}),
      ...(search ? { name: ciContains(search) } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true, sku: true, name: true, category: true, description: true, unit: true,
          pricePaisa: true, stockQty: true, supplier: true, cropRelevance: true, expiryDate: true,
        },
      }),
      prisma.product.count({ where }),
    ]);
    ok(res, { items, page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (e) {
    next(e);
  }
});

productsRouter.post(
  "/",
  requireAuth,
  requirePermission("products:manage"),
  validate({ body: productBody }),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof productBody>;
      const product = await prisma.product.create({
        data: {
          sku: body.sku,
          name: body.name,
          category: body.category,
          description: body.description,
          unit: body.unit,
          pricePaisa: body.pricePaisa,
          stockQty: body.stockQty,
          batchNo: body.batchNo,
          expiryDate: body.expiryDate,
          supplier: body.supplier,
          cropRelevance: body.cropRelevance,
        },
      });
      await audit({ actorId: getAuth(req).userId, action: "PRODUCT_CREATE", entityType: "Product", entityId: product.id });
      ok(res, product, 201);
    } catch (e) {
      next(e);
    }
  }
);

// ---------------- Cart ----------------
cartRouter.use(requireAuth);

async function getOrCreateCart(userId: string) {
  return prisma.cart.upsert({
    where: { userId },
    update: {},
    create: { userId },
    include: { items: { include: { product: true } } },
  });
}

cartRouter.get("/", async (req, res, next) => {
  try {
    const cart = await getOrCreateCart(getAuth(req).userId);
    const subtotalPaisa = cart.items.reduce((s: number, i: { product: { pricePaisa: number }; qty: number }) => s + i.product.pricePaisa * i.qty, 0);
    ok(res, { ...cart, subtotalPaisa });
  } catch (e) {
    next(e);
  }
});

const addItemSchema = z.object({
  productId: z.string().min(5),
  qty: z.number().int().positive().max(10000),
});

cartRouter.post("/items", validate({ body: addItemSchema }), async (req, res, next) => {
  try {
    const { productId, qty } = req.body as z.infer<typeof addItemSchema>;
    const product = await prisma.product.findFirst({ where: { id: productId, isActive: true } });
    if (!product) throw notFound("Product");
    if (product.stockQty < qty) throw unprocessable("Insufficient stock", { available: product.stockQty });

    const cart = await getOrCreateCart(getAuth(req).userId);
    await prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId } },
      update: { qty },
      create: { cartId: cart.id, productId, qty },
    });
    ok(res, await getOrCreateCart(getAuth(req).userId), 201);
  } catch (e) {
    next(e);
  }
});

cartRouter.delete("/items/:productId", validate({ params: z.object({ productId: z.string().min(1).max(64) }) }), async (req, res, next) => {
  try {
    const cart = await getOrCreateCart(getAuth(req).userId);
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId: req.params.productId } });
    ok(res, { removed: true });
  } catch (e) {
    next(e);
  }
});

// ---------------- Orders ----------------
ordersRouter.use(requireAuth);

ordersRouter.get("/", async (req, res, next) => {
  try {
    const isPrivileged = ["ADMIN", "SUPER_ADMIN"].includes(getAuth(req).role);
    // X-Total-Count: the body stays a capped slice (100) but the
    // caller can tell a full list from a truncated one. Count runs over the
    // exact same scope as the slice, so a window cannot disagree with its total.
    const where = isPrivileged ? {} : { userId: getAuth(req).userId };
    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: { items: true, user: { select: { fullName: true, phone: true } } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
      prisma.order.count({ where }),
    ]);
    res.setHeader("X-Total-Count", String(total));
    ok(res, orders);
  } catch (e) {
    next(e);
  }
});

ordersRouter.get("/:id", async (req, res, next) => {
  try {
    const isPrivileged = ["ADMIN", "SUPER_ADMIN"].includes(getAuth(req).role);
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, ...(isPrivileged ? {} : { userId: getAuth(req).userId }) },
      include: { items: true, user: { select: { fullName: true } } },
    });
    if (!order) throw notFound("Order");
    ok(res, order);
  } catch (e) {
    next(e);
  }
});

/**
 * Delete one of my own finished orders (removes the order + its line items
 * from history). Orders still being fulfilled (PENDING/CONFIRMED/SHIPPED)
 * must be cancelled first. Payment and wallet-ledger rows are financial
 * records and are intentionally kept untouched.
 */
ordersRouter.delete("/:id", async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({ where: { id: req.params.id, userId: getAuth(req).userId } });
    if (!order) throw notFound("Order");
    if (["PENDING", "CONFIRMED", "SHIPPED"].includes(order.status)) {
      throw unprocessable("This order is still in progress — cancel it before deleting");
    }
    await prisma.$transaction(async (tx) => {
      // Sandbox payment rows are simulated (no real money) — they go with the
      // order so the wallet's merged view stays clean. Real-gateway payments
      // (SSLCommerz refs) are financial records and are kept for audit even
      // when the order is removed.
      await tx.payment.deleteMany({
        where: {
          purposeType: "ORDER",
          purposeId: order.id,
          OR: [{ providerRef: { startsWith: "SBX-" } }, { metaStr: { contains: '"mode":"sandbox"' } }],
        },
      });
      await tx.order.delete({ where: { id: order.id } });
    });
    await audit({ actorId: getAuth(req).userId, action: "ORDER_DELETED", entityType: "Order", entityId: order.id, meta: { orderNo: order.orderNo, status: order.status } });
    ok(res, { deleted: true });
  } catch (e) {
    next(e);
  }
});

const cancelOrderSchema = z.object({ reason: z.string().trim().min(3).max(500).optional() });

// Tolerate an absent body (a bare cancel click) while rejecting a present but
// malformed one — same convention as the checkout wizard's shipping fields.
const cancelOrderBodySchema = z.preprocess(
  (raw) => (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}),
  cancelOrderSchema
);

/**
 * Owner cancels an UNPAID CONFIRMED order. Checkout decrements stock when the
 * order is placed, so this is the only path that puts that stock back; without
 * it an unpaid order was stuck (DELETE refuses in-progress orders).
 *
 * Claim-atomic: the status+paymentStatus predicate is part of the UPDATE, so a
 * double-cancel (or a cancel racing a payment) updates 0 rows and restocks
 * nothing. Paid/shipped/delivered orders stay untouched — money already moved.
 */
ordersRouter.post("/:id/cancel", validate({ body: cancelOrderBodySchema }), async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, userId: getAuth(req).userId },
      include: { items: true },
    });
    if (!order) throw notFound("Order");
    const { reason } = req.body as z.infer<typeof cancelOrderSchema>;

    const cancelled = await prisma.$transaction(async (tx: import("@prisma/client").Prisma.TransactionClient) => {
      const claimed = await tx.order.updateMany({
        where: { id: order.id, userId: getAuth(req).userId, status: "CONFIRMED", paymentStatus: "UNPAID" },
        data: { status: "CANCELLED", cancelReason: reason ?? null },
      });
      if (claimed.count !== 1) {
        throw conflict("Order cannot be cancelled — it is already paid or no longer awaiting payment");
      }

      // Restock exactly once per cancelled line (the claim above guarantees it).
      for (const item of order.items) {
        await tx.product.updateMany({ where: { id: item.productId }, data: { stockQty: { increment: item.qty } } });
      }
      return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    }, { timeout: 15000, maxWait: 8000 });

    await audit({ actorId: getAuth(req).userId, action: "ORDER_CANCELLED", entityType: "Order", entityId: order.id, meta: { orderNo: order.orderNo, reason } });
    await notify({
      userId: getAuth(req).userId,
      type: "ORDER",
      titleBn: `অর্ডার বাতিল হয়েছে (${cancelled.orderNo})`,
      titleEn: `Order cancelled (${cancelled.orderNo})`,
      bodyBn: "অপরিশোধিত অর্ডারটি বাতিল করা হয়েছে; মজুত ফেরত নেওয়া হয়েছে।",
      bodyEn: "The unpaid order was cancelled and its stock was returned.",
      refType: "ORDER",
      refId: cancelled.id,
    });
    ok(res, cancelled);
  } catch (e) {
    next(e);
  }
});

/**
 * Delivery details captured by the checkout wizard. All three fields are
 * optional together (an order can still be placed without them), but a field
 * that IS sent must be valid — the previous safeParse.data silently dropped
 * a malformed phone or address, so the buyer's details vanished with a 201.
 */
const shippingSchema = z.object({
  shippingName: z.string().trim().min(2).max(120).optional(),
  shippingPhone: z.string().regex(/^01[3-9]\d{8}$/).optional(),
  shippingAddress: z.string().trim().min(5).max(400).optional(),
});

// optional checkout idempotency key. Opaque client token, bounded
// (8..100 chars) so a hostile client cannot stuff unbounded keys into the
// unique index. The composite unique is (userId, clientRequestId).
const checkoutSchema = shippingSchema.extend({
  clientRequestId: z.string().min(8).max(100).optional(),
});

// Tolerate a completely absent body (clients released before the wizard sent
// delivery details POST with no payload at all) while still rejecting a body
// that is present but malformed.
const checkoutBodySchema = z.preprocess(
  (raw) => (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}),
  checkoutSchema
);

/** Replay lookup used both up-front and after a lost race: one key = one order. */
async function findOrderByClientKey(userId: string, clientRequestId: string) {
  return prisma.order.findFirst({ where: { userId, clientRequestId }, include: { items: true } });
}

/**
 * Checkout: transactional stock reservation + order creation + membership discount.
 * Stock decrement and order creation are atomic (Rule: transactional consistency).
 *
 * Idempotency: when `clientRequestId` is supplied, the first request
 * that creates an order with that key owns it. Later requests — sequentially,
 * after a network failure, or racing in parallel — replay that SAME order with
 * 200 and cause no stock or ledger side effects. Contract: one key = one order
 * for its lifetime; a key later re-used for a DIFFERENT cart still replays the
 * FIRST order created under it (the client must mint a fresh key per checkout).
 */
ordersRouter.post(
  "/checkout",
  checkoutLimiter,
  acceptIdempotencyKeyHeader,
  validate({ body: checkoutBodySchema }),
  async (req, res, next) => {
  try {
    const { clientRequestId: bodyKey, ...shipping } = req.body as z.infer<typeof checkoutSchema>;
    // The `Idempotency-Key` header wins when both are present; the body field
    // stays supported for clients released before the header existed. Either
    // way the value lands in the same `clientRequestId` column, so replays
    // from old and new clients resolve through the same lookup.
    const clientRequestId = idempotencyKeyOf(req) ?? bodyKey;

    // Fast path: this key already produced an order (retry, reload, duplicate
    // submit). Replay it before any stock move or cart mutation.
    if (clientRequestId) {
      const replay = await findOrderByClientKey(getAuth(req).userId, clientRequestId);
      if (replay) {
        ok(res, replay);
        return;
      }
    }

    const membership = await getActiveMembership(getAuth(req).userId);
    const discountPct = membership.discountPct;

    try {
      const result = await prisma.$transaction(async (tx: import("@prisma/client").Prisma.TransactionClient) => {
        const cart = await tx.cart.findUnique({
          where: { userId: getAuth(req).userId },
          include: { items: { include: { product: true } } },
        });
        if (!cart || cart.items.length === 0) throw badRequest("Cart is empty");

        for (const item of cart.items) {
          if (item.product.stockQty < item.qty) {
            throw unprocessable(`Insufficient stock for ${item.product.name}`, { available: item.product.stockQty });
          }
        }

        // Duplicate-submit gate: the cart rows ARE the idempotency token. The
        // first attempt deletes every row it just read and proceeds with the
        // in-memory snapshot; a parallel retry (which also read the cart before
        // this commit) deletes 0 rows and is rejected here — before any stock
        // move or order row — instead of placing a second order.
        const cartClaim = await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        if (cartClaim.count !== cart.items.length) {
          throw conflict("Checkout already in progress — your cart was emptied by another attempt");
        }

        let subtotalPaisa = 0;
        for (const item of cart.items) {
          // Atomic conditional decrement: only succeeds when sufficient stock exists,
          // preventing overselling under concurrent checkouts (PostgreSQL-safe).
          const claimed = await tx.product.updateMany({
            where: { id: item.productId, stockQty: { gte: item.qty }, isActive: true },
            data: { stockQty: { decrement: item.qty } },
          });
          if (claimed.count !== 1) {
            throw unprocessable(`Insufficient stock for ${item.product.name}`, { available: item.product.stockQty });
          }
          subtotalPaisa += item.product.pricePaisa * item.qty;
        }

        // Discount + delivery fee + total come from the shared money engine
        // (src/shared/utils/money.ts) so the property tests exercise the exact
        // production arithmetic.
        const { discountPaisa, deliveryFeePaisa, totalPaisa } = orderTotals(subtotalPaisa, discountPct);

        const order = await tx.order.create({
          data: {
            orderNo: refNo("ORD"),
            userId: getAuth(req).userId,
            status: "CONFIRMED",
            subtotalPaisa,
            discountPaisa,
            deliveryFeePaisa,
            totalPaisa,
            ...shipping,
            ...(clientRequestId ? { clientRequestId } : {}),
            items: {
              create: cart.items.map((i: { productId: string; product: { name: string; sku: string; pricePaisa: number }; qty: number }) => ({
                productId: i.productId,
                nameSnapshot: i.product.name,
                skuSnapshot: i.product.sku,
                unitPricePaisa: i.product.pricePaisa,
                qty: i.qty,
              })),
            },
          },
          include: { items: true },
        });

        // The cart was already cleared by the claim above (same transaction), so
        // a failure anywhere below rolls the claim back with it.
        return order;
      }, { timeout: 15000, maxWait: 8000 });

      await audit({
        actorId: getAuth(req).userId,
        action: "ORDER_CHECKOUT",
        entityType: "Order",
        entityId: result.id,
        meta: { totalPaisa: result.totalPaisa },
      });

      await notify({
        userId: getAuth(req).userId,
        type: "ORDER",
        titleBn: `অর্ডার নিশ্চিত হয়েছে (${result.orderNo})`,
        titleEn: `Order confirmed (${result.orderNo})`,
        bodyBn: `মোট মূল্য ৳${(result.totalPaisa / 100).toFixed(2)}। পেমেন্ট করুন।`,
        bodyEn: `Total ৳${(result.totalPaisa / 100).toFixed(2)}. Please complete payment.`,
        refType: "ORDER",
        refId: result.id,
      });

      ok(res, result, 201);
    } catch (e) {
      // Lost-race replay: P2002 on (userId, clientRequestId) — or a refused
      // cart claim / emptied cart — means a parallel attempt with the SAME key
      // may have committed first. That order is the winner: replay it with 200
      // and leave every side effect to the winner. Without a key this branch is
      // skipped entirely, so the keyless 409 ("another attempt") wording is
      // unchanged. If the winner has not committed yet nothing is found and the
      // original error stands — the client's retry then replays it.
      if (clientRequestId) {
        const replay = await findOrderByClientKey(getAuth(req).userId, clientRequestId).catch(() => null);
        if (replay) {
          ok(res, replay);
          return;
        }
      }
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

