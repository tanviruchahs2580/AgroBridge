import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { forbidden, notFound, badRequest } from "../../shared/errors/index.js";
import { ok } from "../../middleware/context.js";
import { audit } from "../../middleware/audit.js";
import { notify } from "../../providers/notification/service.js";
import { assertNotSelfDealing } from "../../lib/separationOfDuties.js";
import { getAuth } from "../../shared/auth-context.js";
import { ciContains } from "../../shared/utils/ciContains.js";

export const adminRouter = Router();
adminRouter.use(requireAuth);

/**
 * This module's authorization is expressed per route with
 * `requirePermission(...)` — the only gate mechanism the project recognises.
 *
 * It used to open with an inline role list
 * (`["ADMIN","SUPER_ADMIN","REGIONAL_MANAGER","AREA_MANAGER","PROCUREMENT_MANAGER"]`),
 * which the route-role matrix's static parser cannot see, so `docs/route-role-matrix.md`
 * could not report who may reach these routes (F-08). The list was also *not* the
 * real boundary: every route below re-checks a permission anyway, so a role could
 * pass this gate and still be refused — the matrix reported one answer and the
 * code enforced another. Removing it changes no decision:
 *
 *   - `admin:metrics`      — ADMIN, SUPER_ADMIN, REGIONAL_MANAGER (as before)
 *   - `users:read`         — ADMIN tier only; the old gate admitted
 *                            REGIONAL_MANAGER/AREA_MANAGER/PROCUREMENT_MANAGER
 *                            here to be refused on the next line
 *   - `audit:read`, `finance:withdrawals`, `users:manage` — ADMIN tier only
 *
 * A route added to this module without `requirePermission` now fails
 * `tests/permission-reachability.test.ts` instead of being silently covered by
 * a module gate nobody re-reads.
 */

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
    // 404, not 400: the resource named by the path does not exist. A 400 read as
    // "your request was malformed" for what is an absent row (F-70).
    if (!target) throw notFound("User");

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

/**
 * Impersonation-free support view: issue a scoped read-only audit marker
 * instead (security). Query is schema-validated (F-04): page/pageSize coerce
 * with sane clamps, and entityType/actorId filter via the indexes the schema
 * already carries (@@index([entityType, entityId]), @@index([actorId])) —
 * before this, a support triage of "every ORG_* action" had to page the whole
 * log by hand.
 */
/**
 * AUD-116 (kept): malformed pagination clamps to sane integers — `page=abc`
 * falls back to the default, `pageSize=100000` clamps to the cap — because a
 * support view must never 500 on a fat-fingered URL. F-04 (new): the route
 * still goes through validate(), and the entityType/actorId/action filters
 * the schema already indexes are real filters.
 */
const clampedInt = (fallback: number, min: number, max: number) =>
  z
    .preprocess(
      (v) => {
        if (v === undefined || v === "") return undefined;
        const n = Number(v);
        return Number.isFinite(n) ? Math.floor(n) : undefined;
      },
      z.number().int().optional(),
    )
    .transform((n) => Math.min(max, Math.max(min, n ?? fallback)));
const auditLogQuery = z.object({
  page: clampedInt(1, 1, 10_000),
  pageSize: clampedInt(50, 1, 100),
  entityType: z.string().trim().min(1).max(64).optional(),
  actorId: z.string().trim().min(1).max(64).optional(),
  action: z.string().trim().min(1).max(64).optional(),
});
adminRouter.get("/audit-logs", requirePermission("audit:read"), validate({ query: auditLogQuery }), async (req, res, next) => {
  try {
    const q = req.query as unknown as z.infer<typeof auditLogQuery>;
    const where = {
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.action ? { action: q.action } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: { actor: { select: { fullName: true, role: true } } },
        orderBy: { createdAt: "desc" },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.auditLog.count({ where }),
    ]);
    ok(res, { items, total, page: q.page, totalPages: Math.max(1, Math.ceil(total / q.pageSize)) });
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

const withdrawalQuery = z.object({
  // Case-insensitive on input (the old handler uppercased), but unknown
  // statuses are rejected (400) instead of silently meaning "all rows" —
  // finance filters must fail loud (F-04).
  status: z
    .string()
    .transform((s) => s.toUpperCase())
    .pipe(z.enum(["PENDING", "APPROVED", "REJECTED", "PAID"]))
    .default("PENDING"),
});
adminRouter.get("/withdrawals", requirePermission("finance:withdrawals"), validate({ query: withdrawalQuery }), async (req, res, next) => {
  try {
    const { status } = req.query as unknown as z.infer<typeof withdrawalQuery>;
    const where = { status };
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
      // Separation of duties (money stream request, owner-approved): the account
      // that REQUESTED a withdrawal must not be the account that approves or
      // marks it paid. `finance:withdrawals` is held by the ADMIN tier, so a
      // privileged user's own withdrawal would otherwise clear itself — one
      // actor on both sides of a payout. SUPER_ADMIN keeps the documented
      // break-glass exception inside assertNotSelfDealing. Enforced before the
      // claim transaction so a refused self-approval moves no money and no state.
      const existing = await prisma.withdrawal.findUnique({ where: { id: req.params.id }, select: { userId: true } });
      if (!existing) throw notFound("Withdrawal");
      assertNotSelfDealing(getAuth(req).userId, existing.userId, getAuth(req).role, "This withdrawal");
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
    // `|| 30` belongs there: without it a non-numeric ?days=abc made the clamp
    // return NaN, which became an Invalid Date and reached Prisma as a filter
    // value — a 500 on an admin endpoint from a query string (AUD-120). Same
    // clamp-and-fall-back the audit-logs route below uses.
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
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
