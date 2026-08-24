import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { notFound, badRequest, unprocessable } from "../../lib/errors.js";
import { ok } from "../../middleware/context.js";
import { tierDiscountPct } from "../../lib/money.js";
import { audit } from "../../middleware/audit.js";
import { notify } from "../../providers/notification/service.js";
import { refNo } from "../../lib/money.js";

export const productsRouter = Router();
export const cartRouter = Router();
export const ordersRouter = Router();

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
      ...(search ? { name: { contains: search } } : {}),
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
      const product = await prisma.product.create({ data: req.body as never });
      await audit({ actorId: req.auth!.userId, action: "PRODUCT_CREATE", entityType: "Product", entityId: product.id });
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
    const cart = await getOrCreateCart(req.auth!.userId);
    const subtotalPaisa = cart.items.reduce((s, i) => s + i.product.pricePaisa * i.qty, 0);
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

    const cart = await getOrCreateCart(req.auth!.userId);
    await prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId } },
      update: { qty },
      create: { cartId: cart.id, productId, qty },
    });
    ok(res, await getOrCreateCart(req.auth!.userId), 201);
  } catch (e) {
    next(e);
  }
});

cartRouter.delete("/items/:productId", async (req, res, next) => {
  try {
    const cart = await getOrCreateCart(req.auth!.userId);
    await prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId: req.params.productId! } });
    ok(res, { removed: true });
  } catch (e) {
    next(e);
  }
});

// ---------------- Orders ----------------
ordersRouter.use(requireAuth);

ordersRouter.get("/", async (req, res, next) => {
  try {
    const isPrivileged = ["ADMIN", "SUPER_ADMIN"].includes(req.auth!.role);
    const orders = await prisma.order.findMany({
      where: isPrivileged ? {} : { userId: req.auth!.userId },
      include: { items: true, user: { select: { fullName: true, phone: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    ok(res, orders);
  } catch (e) {
    next(e);
  }
});

ordersRouter.get("/:id", async (req, res, next) => {
  try {
    const isPrivileged = ["ADMIN", "SUPER_ADMIN"].includes(req.auth!.role);
    const order = await prisma.order.findFirst({
      where: { id: req.params.id!, ...(isPrivileged ? {} : { userId: req.auth!.userId }) },
      include: { items: true, user: { select: { fullName: true } } },
    });
    if (!order) throw notFound("Order");
    ok(res, order);
  } catch (e) {
    next(e);
  }
});

/**
 * Checkout: transactional stock reservation + order creation + membership discount.
 * Stock decrement and order creation are atomic (Rule: transactional consistency).
 */
ordersRouter.post("/checkout", async (req, res, next) => {
  try {
    const profile = await prisma.farmerProfile.findUnique({ where: { userId: req.auth!.userId } });
    const discountPct = tierDiscountPct(profile?.membershipTier);

    const result = await prisma.$transaction(async (tx) => {
      const cart = await tx.cart.findUnique({
        where: { userId: req.auth!.userId },
        include: { items: { include: { product: true } } },
      });
      if (!cart || cart.items.length === 0) throw badRequest("Cart is empty");

      for (const item of cart.items) {
        if (item.product.stockQty < item.qty) {
          throw unprocessable(`Insufficient stock for ${item.product.name}`, { available: item.product.stockQty });
        }
      }

      let subtotalPaisa = 0;
      for (const item of cart.items) {
        subtotalPaisa += item.product.pricePaisa * item.qty;
        await tx.product.update({
          where: { id: item.productId },
          data: { stockQty: { decrement: item.qty } },
        });
      }

      const discountPaisa = Math.round((subtotalPaisa * discountPct) / 100);
      const deliveryFeePaisa = subtotalPaisa >= 500_000 ? 0 : 5_000; // free delivery over BDT 5000
      const totalPaisa = subtotalPaisa - discountPaisa + deliveryFeePaisa;

      const order = await tx.order.create({
        data: {
          orderNo: refNo("ORD"),
          userId: req.auth!.userId,
          status: "CONFIRMED",
          subtotalPaisa,
          discountPaisa,
          deliveryFeePaisa,
          totalPaisa,
          items: {
            create: cart.items.map((i) => ({
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

      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      return order;
    });

    await audit({
      actorId: req.auth!.userId,
      action: "ORDER_CHECKOUT",
      entityType: "Order",
      entityId: result.id,
      meta: { totalPaisa: result.totalPaisa },
    });

    await notify({
      userId: req.auth!.userId,
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
    next(e);
  }
});

