import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { forbidden, badRequest } from "../../shared/errors/index.js";
import { ok } from "../../middleware/context.js";
import { audit } from "../../middleware/audit.js";
import { notify } from "../../providers/notification/service.js";
import { getAuth } from "../../shared/auth-context.js";
import { ciContains } from "../../shared/utils/ciContains.js";

export const adminRouter = Router();
adminRouter.use(requireAuth);

/** All admin routes require at least one elevated permission. */
adminRouter.use((req, res, next) => {
  if (!["ADMIN", "SUPER_ADMIN", "REGIONAL_MANAGER", "AREA_MANAGER", "PROCUREMENT_MANAGER"].includes(getAuth(req).role)) {
    return next(forbidden("Admin area"));
  }
  next();
});

// ---- Metrics: every number maps to real backend data ----
// Company-wide revenue and farmer counts are not AREA/PROCUREMENT-manager
// concerns; the permission map grants admin:metrics to ADMIN, SUPER_ADMIN and
// REGIONAL_MANAGER only.
adminRouter.get("/metrics", requirePermission("admin:metrics"), async (_req, res, next) => {
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
        // Revenue = money flowing IN (orders, bookings, memberships).
        // PROCUREMENT payouts are wallet credits to farmers (outflow) stored
        // as SUCCEEDED payments — counting them would fabricate revenue.
        prisma.payment.aggregate({ where: { status: "SUCCEEDED", purposeType: { not: "PROCUREMENT" } }, _sum: { amountPaisa: true } }),
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

/**
 * User directory. Paged PII (name, phone, email, membership tier), so it needs
 * the users:read permission — the router-level role gate alone would have let
 * REGIONAL_MANAGER / AREA_MANAGER / PROCUREMENT_MANAGER read every account.
 */
adminRouter.get("/users", requirePermission("users:read"), validate({ query: userQuery }), async (req, res, next) => {
  try {
    const q = req.query as unknown as z.infer<typeof userQuery>;
    const where = {
      ...(q.role ? { role: q.role } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.search ? { OR: [{ fullName: ciContains(q.search) }, { phone: ciContains(q.search) }] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        // `region` is included because the panel EDITS it (PATCH /admin/users/:id
        // accepts it); omitting it from the read meant the field rendered empty and
        // an admin could not see the value they were about to overwrite.
        select: { id: true, fullName: true, phone: true, email: true, role: true, status: true, region: true, createdAt: true, farmerProfile: { select: { membershipTier: true, district: true } } },
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
    const body = req.body as z.infer<typeof userUpdate>;
    const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, role: true } });
    if (!target) throw badRequest("User not found");

    if (target.id === getAuth(req).userId) {
      if (body.status === "SUSPENDED") throw badRequest("You cannot suspend your own account");
      if (body.role && body.role !== target.role) throw badRequest("You cannot change your own role");
    }
    // Privilege boundaries: only a SUPER_ADMIN may grant or revoke the two
    // admin tiers. Without this an ADMIN could mint a SUPER_ADMIN (wildcard
    // permissions) or demote the account that governs it.
    const ACTOR_MUST_BE_SUPER = ["ADMIN", "SUPER_ADMIN"];
    const actorRole = getAuth(req).role;
    if (actorRole !== "SUPER_ADMIN") {
      if (body.role && ACTOR_MUST_BE_SUPER.includes(body.role)) {
        throw forbidden("Only a SUPER_ADMIN can grant admin roles");
      }
      if (ACTOR_MUST_BE_SUPER.includes(target.role)) {
        throw forbidden("Only a SUPER_ADMIN can modify an admin account");
      }
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      // Only the keys the schema actually received: `null` is a meaningful
      // region value (clearing it) and must not be confused with "unchanged",
      // so an absent key is omitted rather than sent as undefined.
      data: {
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.region !== undefined ? { region: body.region } : {}),
      },
      select: { id: true, fullName: true, role: true, status: true },
    });
    // Revoke all sessions on role/status change
    await prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit({ actorId: getAuth(req).userId, action: "ADMIN_USER_UPDATE", entityType: "User", entityId: user.id, meta: req.body as Record<string, unknown> });
    ok(res, user);
  } catch (e) {
    next(e);
  }
});

/** Impersonation-free support view: issue a scoped read-only audit marker instead (security). */
adminRouter.get("/audit-logs", requirePermission("audit:read"), async (req, res, next) => {
  try {
    // Non-numeric query values previously flowed into skip/take as NaN
    // (Prisma error → 500); clamp to sane integers instead.
    const page = Math.max(1, Math.floor(Number(req.query.page ?? 1)) || 1);
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(req.query.pageSize ?? 50)) || 50));
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
    ok(res, byProvider.map((p: { provider: string; _count: { _all: number }; _avg: { latencyMs: number | null } }) => ({ provider: p.provider, count: p._count._all, avgLatencyMs: p._avg.latencyMs })));
  } catch (e) {
    next(e);
  }
});

// ---- Withdrawal approvals (finance) ----

adminRouter.get("/withdrawals", requirePermission("finance:withdrawals"), async (req, res, next) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status.toUpperCase() : "PENDING";
    const where = ["PENDING", "APPROVED", "REJECTED", "PAID"].includes(status) ? { status } : {};
    // X-Total-Count: the queue body stays a capped slice (100); the
    // header is the selected status' true count so finance can see truncation.
    const [items, total] = await Promise.all([
      prisma.withdrawal.findMany({
        where,
        include: { user: { select: { fullName: true, phone: true, phoneVerified: true } } },
        orderBy: { createdAt: "asc" },
        take: 100,
      }),
      prisma.withdrawal.count({ where }),
    ]);
    res.setHeader("X-Total-Count", String(total));
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
      const w = await prisma.$transaction(async (tx: import("@prisma/client").Prisma.TransactionClient) => {
        if (action === "APPROVE") {
          // APPROVE debits the wallet now and releases the request-time hold.
          // The claim update locks the Withdrawal row; the wallet writes below
          // serialize hold maintenance with concurrent withdrawal requests.
          const claimed = await tx.withdrawal.updateMany({
            where: { id: req.params.id, status: "PENDING" },
            data: { status: "APPROVED", decidedBy: getAuth(req).userId, decidedAt: new Date(), note },
          });
          if (claimed.count !== 1) throw badRequest("Withdrawal not in PENDING state");
          const wd = await tx.withdrawal.findUniqueOrThrow({ where: { id: req.params.id } });
          await tx.wallet.updateMany({
            where: { userId: wd.userId },
            data: { heldPaisa: { decrement: wd.amountPaisa } },
          });
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
            where: { id: req.params.id, status: "PENDING" },
            data: { status: "REJECTED", decidedBy: getAuth(req).userId, decidedAt: new Date(), note },
          });
          if (claimed.count !== 1) throw badRequest("Withdrawal not in PENDING state");
          const wd = await tx.withdrawal.findUniqueOrThrow({ where: { id: req.params.id } });
          // Release the request-time hold so the funds become withdrawable again.
          await tx.wallet.updateMany({
            where: { userId: wd.userId },
            data: { heldPaisa: { decrement: wd.amountPaisa } },
          });
          return wd;
        }
        // MARK_PAID: after the manual bKash/Nagad/bank transfer completes.
        const claimed = await tx.withdrawal.updateMany({
          where: { id: req.params.id, status: "APPROVED" },
          data: { status: "PAID", decidedBy: getAuth(req).userId, decidedAt: new Date(), note },
        });
        if (claimed.count !== 1) throw badRequest("Withdrawal not in APPROVED state");
        return tx.withdrawal.findUniqueOrThrow({ where: { id: req.params.id } });
      }, { timeout: 15000, maxWait: 8000 });

      await audit({ actorId: getAuth(req).userId, action: `WITHDRAWAL_${action}`, entityType: "Withdrawal", entityId: w.id });
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
      events: byName.map((b: { name: string; _count: { _all: number } }) => ({ name: b.name, count: b._count._all })),
      activeDaysSample: dau.length,
    });
  } catch (e) {
    next(e);
  }
});
