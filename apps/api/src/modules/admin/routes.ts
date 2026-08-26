import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { forbidden, badRequest } from "../../lib/errors.js";
import { ok } from "../../middleware/context.js";
import { audit } from "../../middleware/audit.js";
import { notify } from "../../providers/notification/service.js";

export const adminRouter = Router();
adminRouter.use(requireAuth);

/** All admin routes require at least one elevated permission. */
adminRouter.use((req, res, next) => {
  if (!["ADMIN", "SUPER_ADMIN", "REGIONAL_MANAGER", "AREA_MANAGER", "PROCUREMENT_MANAGER"].includes(req.auth!.role)) {
    return next(forbidden("Admin area"));
  }
  next();
});

// ---- Metrics: every number maps to real backend data (Rule 27/53) ----
adminRouter.get("/metrics", async (_req, res, next) => {
  try {
    const [farmers, activeFarmers, farms, activeCrops, orders, bookings, procurementPending, paymentsSucceeded, aiQueries] =
      await Promise.all([
        prisma.user.count({ where: { role: "FARMER" } }),
        prisma.user.count({ where: { role: "FARMER", status: "ACTIVE" } }),
        prisma.farm.count(),
        prisma.cropCycle.count({ where: { status: "ACTIVE" } }),
        prisma.order.count(),
        prisma.booking.count(),
        prisma.procurementOrder.count({ where: { status: { in: ["SUBMITTED", "QC"] } } }),
        prisma.payment.aggregate({ where: { status: "SUCCEEDED" }, _sum: { amountPaisa: true } }),
        prisma.advisoryQuery.count(),
      ]);

    ok(res, {
      farmers,
      activeFarmers,
      farms,
      activeCrops,
      orders,
      bookings,
      pendingProcurement: procurementPending,
      revenuePaisa: paymentsSucceeded._sum.amountPaisa ?? 0,
      aiAdvisoryQueries: aiQueries,
    });
  } catch (e) {
    next(e);
  }
});

// ---- User management ----
const userQuery = z.object({
  role: z.string().optional(),
  status: z.string().optional(),
  search: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

adminRouter.get("/users", validate({ query: userQuery }), async (req, res, next) => {
  try {
    const q = req.query as unknown as z.infer<typeof userQuery>;
    const where = {
      ...(q.role ? { role: q.role } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.search ? { OR: [{ fullName: { contains: q.search } }, { phone: { contains: q.search } }] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: { id: true, fullName: true, phone: true, email: true, role: true, status: true, createdAt: true, farmerProfile: { select: { membershipTier: true, district: true } } },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        orderBy: { createdAt: "desc" },
      }),
      prisma.user.count({ where }),
    ]);
    ok(res, { items, total, page: q.page, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) });
  } catch (e) {
    next(e);
  }
});

const VALID_ROLES = ["SUPER_ADMIN","ADMIN","REGIONAL_MANAGER","AREA_MANAGER","FIELD_AGENT","COLLECTION_MANAGER","WAREHOUSE_MANAGER","PROCUREMENT_MANAGER","SERVICE_PROVIDER","DEALER","CORPORATE","COOPERATIVE","FARMER"];

const userUpdate = z.object({
  role: z.string().refine((r) => VALID_ROLES.includes(r), "Invalid role").optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  region: z.string().trim().max(60).nullable().optional(),
});

adminRouter.patch("/users/:id", requirePermission("users:manage"), validate({ body: userUpdate }), async (req, res, next) => {
  try {
    if (req.params.id === req.auth!.userId && (req.body as { status?: string }).status === "SUSPENDED") {
      throw badRequest("You cannot suspend your own account");
    }
    const user = await prisma.user.update({
      where: { id: req.params.id! },
      data: req.body as never,
      select: { id: true, fullName: true, role: true, status: true },
    });
    // Revoke all sessions on role/status change
    await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit({ actorId: req.auth!.userId, action: "ADMIN_USER_UPDATE", entityType: "User", entityId: user.id, meta: req.body as Record<string, unknown> });
    ok(res, user);
  } catch (e) {
    next(e);
  }
});

/** Impersonation-free support view: issue a scoped read-only audit marker instead (security). */
adminRouter.get("/audit-logs", requirePermission("audit:read"), async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const pageSize = Math.min(100, Number(req.query.pageSize ?? 50));
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        include: { actor: { select: { fullName: true, role: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.auditLog.count(),
    ]);
    ok(res, { items, total, page, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/ai-usage", requirePermission("admin:metrics"), async (_req, res, next) => {
  try {
    const byProvider = await prisma.aiUsageLog.groupBy({
      by: ["provider"],
      _count: { _all: true },
      _avg: { latencyMs: true },
    });
    ok(res, byProvider.map((p) => ({ provider: p.provider, count: p._count._all, avgLatencyMs: p._avg.latencyMs })));
  } catch (e) {
    next(e);
  }
});

// ---- Withdrawal approvals (finance) ----

adminRouter.get("/withdrawals", requirePermission("finance:withdrawals"), async (req, res, next) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : "PENDING";
    const where = ["PENDING", "APPROVED", "REJECTED", "PAID"].includes(status) ? { status } : {};
    const items = await prisma.withdrawal.findMany({
      where,
      include: { user: { select: { fullName: true, phone: true, phoneVerified: true } } },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    ok(res, items);
  } catch (e) {
    next(e);
  }
});

const decisionSchema = z.object({
  action: z.enum(["APPROVE", "REJECT", "MARK_PAID"]),
  note: z.string().trim().max(300).optional(),
});

adminRouter.post(
  "/withdrawals/:id/decision",
  requirePermission("finance:withdrawals"),
  validate({ body: decisionSchema }),
  async (req, res, next) => {
    try {
      const { action, note } = req.body as { action: string; note?: string };
      const w = await prisma.$transaction(async (tx) => {
        if (action === "APPROVE") {
          // APPROVE debits the wallet now and holds the amount for transfer.
          const claimed = await tx.withdrawal.updateMany({
            where: { id: req.params.id!, status: "PENDING" },
            data: { status: "APPROVED", decidedBy: req.auth!.userId, decidedAt: new Date(), note },
          });
          if (claimed.count !== 1) throw badRequest("Withdrawal not in PENDING state");
          const wd = await tx.withdrawal.findUniqueOrThrow({ where: { id: req.params.id! } });
          const wallet = await tx.wallet.upsert({
            where: { userId: wd.userId },
            update: { balancePaisa: { decrement: wd.amountPaisa } },
            create: { userId: wd.userId, balancePaisa: -wd.amountPaisa },
          });
          await tx.walletTransaction.create({
            data: {
              userId: wd.userId,
              direction: "DEBIT",
              amountPaisa: wd.amountPaisa,
              reason: `Withdrawal ${wd.refNo}`,
              balanceAfterPaisa: wallet.balancePaisa,
              refType: "WITHDRAWAL",
              refId: wd.id,
            },
          });
          return wd;
        }
        if (action === "REJECT") {
          const claimed = await tx.withdrawal.updateMany({
            where: { id: req.params.id!, status: "PENDING" },
            data: { status: "REJECTED", decidedBy: req.auth!.userId, decidedAt: new Date(), note },
          });
          if (claimed.count !== 1) throw badRequest("Withdrawal not in PENDING state");
          return tx.withdrawal.findUniqueOrThrow({ where: { id: req.params.id! } });
        }
        // MARK_PAID: after the manual bKash/Nagad/bank transfer completes.
        const claimed = await tx.withdrawal.updateMany({
          where: { id: req.params.id!, status: "APPROVED" },
          data: { status: "PAID", decidedBy: req.auth!.userId, decidedAt: new Date(), note },
        });
        if (claimed.count !== 1) throw badRequest("Withdrawal not in APPROVED state");
        return tx.withdrawal.findUniqueOrThrow({ where: { id: req.params.id! } });
      }, { timeout: 15000, maxWait: 8000 });

      await audit({ actorId: req.auth!.userId, action: `WITHDRAWAL_${action}`, entityType: "Withdrawal", entityId: w.id });
      await notify({
        userId: w.userId,
        type: "PAYMENT",
        category: "CRITICAL",
        titleBn: `উইথড্র আপডেট (${w.refNo})`,
        titleEn: `Withdrawal update (${w.refNo})`,
        bodyBn: `অবস্থা: ${w.status}`,
        bodyEn: `Status: ${w.status}`,
        refType: "WITHDRAWAL",
        refId: w.id,
      });
      ok(res, w);
    } catch (e) {
      next(e);
    }
  }
);

// ---- Analytics summary ----

adminRouter.get("/analytics/summary", requirePermission("admin:metrics"), async (req, res, next) => {
  try {
    const days = Math.min(90, Math.max(1, Number(req.query.days ?? 30)));
    const since = new Date(Date.now() - days * 86_400_000);

    const [byName, dau] = await Promise.all([
      prisma.analyticsEvent.groupBy({
        by: ["name"],
        where: { createdAt: { gte: since } },
        _count: { _all: true },
        orderBy: { _count: { name: "desc" } },
      }),
      prisma.analyticsEvent.groupBy({
        by: ["createdAt"],
        where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) }, userId: { not: null } },
        _count: { _all: true },
      }),
    ]);

    ok(res, {
      windowDays: days,
      events: byName.map((b) => ({ name: b.name, count: b._count._all })),
      activeDaysSample: dau.length,
    });
  } catch (e) {
    next(e);
  }
});
