import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { requirePermission } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { notFound, forbidden, unprocessable, conflict } from "../../shared/errors/index.js";
import { ok } from "../../middleware/context.js";
import { refNo } from "../../lib/money.js";
import { notify } from "../../providers/notification/service.js";
import { actorRegionLimit, assertSubjectInRegion } from "../../lib/territory.js";

export const servicesRouter = Router();
export const bookingsRouter = Router();

servicesRouter.use(requireAuth);

servicesRouter.get("/", async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const services = await prisma.service.findMany({
      where: { isActive: true },
      include: {
        providers: { where: { isActive: true }, select: { id: true, name: true, district: true, ratingSum: true, ratingCount: true } },
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    ok(res, services);
  } catch (e) {
    next(e);
  }
});

const serviceBody = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(120),
  category: z.enum(["DRONE", "TRACTOR", "COMBINE_HARVESTER", "RICE_TRANSPLANTER", "POWER_TILLER", "LAND_LEVELLER", "THRESHER", "SOIL_TESTING", "AGRONOMIST", "OTHER"]),
  basePricePaisa: z.number().int().positive(),
  priceUnit: z.string().default("PER_BIGHA"),
  description: z.string().trim().max(1000).optional(),
});

servicesRouter.post("/", requirePermission("services:manage"), validate({ body: serviceBody }), async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const body: z.infer<typeof serviceBody> = req.body;
    ok(res, await prisma.service.create({
      data: {
        code: body.code,
        name: body.name,
        category: body.category,
        basePricePaisa: body.basePricePaisa,
        priceUnit: body.priceUnit,
        description: body.description,
      },
    }), 201);
  } catch (e) {
    next(e);
  }
});

const providerBody = z.object({
  serviceId: z.string().min(5),
  userId: z.string().optional(),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(20).optional(),
  district: z.string().trim().max(60).optional(),
});

servicesRouter.post("/providers", requirePermission("providers:manage"), validate({ body: providerBody }), async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const body: z.infer<typeof providerBody> = req.body;
    ok(res, await prisma.serviceProvider.create({
      data: {
        serviceId: body.serviceId,
        userId: body.userId,
        name: body.name,
        phone: body.phone,
        district: body.district,
      },
    }), 201);
  } catch (e) {
    next(e);
  }
});

// ---------------- Bookings ----------------
bookingsRouter.use(requireAuth);

const bookingCreate = z.object({
  farmId: z.string().min(5),
  serviceId: z.string().min(5),
  providerId: z.string().optional(),
  scheduledFor: z.coerce.date(),
  areaBigha: z.number().positive().max(10000),
});

bookingsRouter.post(
  "/",
  validate({ body: bookingCreate }),
  async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    try {
      const b = req.body as z.infer<typeof bookingCreate>;

      // Ownership + validation
      const farm = await prisma.farm.findFirst({ where: { id: b.farmId, ownerId: req.auth!.userId } });
      if (!farm) throw forbidden("Farm not found in your account");
      const service = await prisma.service.findFirst({ where: { id: b.serviceId, isActive: true } });
      if (!service) throw notFound("Service");
      if (b.scheduledFor.getTime() < Date.now() - 60_000) throw unprocessable("Scheduled time must be in the future");

      let providerId: string | undefined;
      if (b.providerId) {
        const p = await prisma.serviceProvider.findFirst({ where: { id: b.providerId, serviceId: service.id, isActive: true } });
        if (!p) throw unprocessable("Selected provider does not serve this service");
        providerId = p.id;
      }

      // Pricing rule: only PER_BIGHA is area-scaled. Every other unit
      // (PER_MAUND / PER_SAMPLE / PER_VISIT / PER_HOUR / ...) describes a flat
      // job, so it is charged once (×1) regardless of the booked area.
      const isPerBigha = service.priceUnit.toUpperCase() === "PER_BIGHA";
      const estimatedPricePaisa = isPerBigha
        ? Math.round(service.basePricePaisa * b.areaBigha)
        : service.basePricePaisa;

      const booking = await prisma.booking.create({
        data: {
          bookingNo: refNo("BKG"),
          userId: req.auth!.userId,
          farmId: farm.id,
          serviceId: service.id,
          providerId,
          scheduledFor: b.scheduledFor,
          areaBigha: b.areaBigha,
          estimatedPricePaisa,
          status: providerId ? "ASSIGNED" : "REQUESTED",
        },
      });

      await notify({
        userId: req.auth!.userId,
        type: "BOOKING",
        titleBn: `সার্ভিস বুকিং গৃহীত (${booking.bookingNo})`,
        titleEn: `Service booking received (${booking.bookingNo})`,
        bodyBn: `${service.name} — তারিখ: ${booking.scheduledFor.toLocaleDateString("bn-BD")}`,
        bodyEn: `${service.name} on ${booking.scheduledFor.toDateString()}`,
        refType: "BOOKING",
        refId: booking.id,
      });

      ok(res, booking, 201);
    } catch (e) {
      next(e);
    }
  }
);

bookingsRouter.get("/", async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const isPrivileged = ["ADMIN", "SUPER_ADMIN"].includes(req.auth!.role);
    const bookings = await prisma.booking.findMany({
      where: isPrivileged ? {} : { userId: req.auth!.userId },
      include: { service: { select: { name: true, category: true } }, farm: { select: { name: true } }, provider: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    ok(res, bookings);
  } catch (e) {
    next(e);
  }
});

const assignSchema = z.object({ providerId: z.string().min(5) });

bookingsRouter.post("/:id/assign", requirePermission("bookings:assign"), validate({ body: assignSchema }), async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const booking = await prisma.booking.findUnique({ where: { id: req.params.id! } });
    if (!booking) throw notFound("Booking");
    // A territory-scoped assigner may only act on bookings from their region.
    await assertSubjectInRegion(
      await actorRegionLimit(req.auth!.userId, req.auth!.role),
      booking.userId,
      "This booking"
    );
    if (!["REQUESTED", "ASSIGNED"].includes(booking.status)) throw unprocessable(`Cannot assign booking in status ${booking.status}`);

    // Provider assignment must respect the same service-compatibility rule as
    // booking creation — a provider registered for another service is not
    // assignable here.
    const provider = await prisma.serviceProvider.findFirst({ where: { id: req.body.providerId as string, serviceId: booking.serviceId, isActive: true } });
    if (!provider) throw unprocessable("Selected provider does not serve this service");

    const updated = await prisma.booking.update({
      where: { id: booking.id },
      data: { providerId: provider.id, status: "ASSIGNED" },
    });

    await notify({
      userId: booking.userId,
      type: "BOOKING",
      titleBn: "সেবা প্রদানকারী নিয়োগ হয়েছে",
      titleEn: "Service provider assigned",
      bodyBn: `প্রদানকারী: ${provider.name}`,
      bodyEn: `Provider: ${provider.name}`,
      refType: "BOOKING",
      refId: booking.id,
    });
    ok(res, updated);
  } catch (e) {
    next(e);
  }
});

bookingsRouter.post("/:id/status", validate({ body: z.object({ status: z.enum(["IN_PROGRESS", "COMPLETED", "CANCELLED"]), reason: z.string().max(300).optional() }) }), async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const role = req.auth!.role;
    const isAdmin = ["ADMIN", "SUPER_ADMIN"].includes(role);
    // SERVICE_PROVIDER may only transition bookings assigned to THEM.
    let scope: Record<string, unknown>;
    if (isAdmin) {
      scope = {};
    } else if (role === "SERVICE_PROVIDER") {
      const provider = await prisma.serviceProvider.findFirst({ where: { userId: req.auth!.userId }, select: { id: true } });
      if (!provider) throw notFound("Provider profile");
      scope = { providerId: provider.id };
    } else {
      scope = { userId: req.auth!.userId };
    }
    const booking = await prisma.booking.findFirst({
      where: { id: req.params.id!, ...scope },
    });
    if (!booking) throw notFound("Booking");

    const { status, reason } = req.body as { status: string; reason?: string };

    // ---- Lifecycle guard (parity with the procurement state machine) ----
    // Terminal states are final: no un-cancelling, no re-completing.
    if (booking.status === "COMPLETED" || booking.status === "CANCELLED") {
      throw conflict(`Booking already ${booking.status}`);
    }
    // Legal transitions. ASSIGNED -> COMPLETED stays open for admins: field
    // services are commonly settled in cash on site (offline settlement).
    const allowed: Record<string, string[]> = {
      REQUESTED: ["CANCELLED"],
      ASSIGNED: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
      IN_PROGRESS: ["COMPLETED", "CANCELLED"],
    };
    if (!allowed[booking.status]?.includes(status)) {
      throw unprocessable(`Cannot transition booking from ${booking.status} to ${status}`);
    }
    if (role !== "SERVICE_PROVIDER" && !isAdmin && status !== "CANCELLED") {
      throw forbidden("Only the assigned provider can progress a booking");
    }
    if (status === "CANCELLED" && booking.status === "IN_PROGRESS" && !isAdmin && role !== "SERVICE_PROVIDER") {
      throw forbidden("Work is in progress; only the provider or an admin can cancel now");
    }

    // Write only the fields belonging to the transition — never null out
    // history (completedAt / cancelReason) as a side effect of moving on.
    // Claim-atomic: the expected current status is part of the WHERE clause, so
    // two racing transitions cannot both apply — the loser updates 0 rows.
    const claimed = await prisma.booking.updateMany({
      where: { id: booking.id, status: booking.status },
      data:
        status === "CANCELLED"
          ? { status, cancelReason: reason ?? null }
          : status === "COMPLETED"
            ? { status, completedAt: new Date() }
            : { status },
    });
    if (claimed.count !== 1) throw conflict("Booking status changed concurrently — reload and retry");
    const updated = await prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });

    await notify({
      userId: booking.userId,
      type: "BOOKING",
      titleBn: status === "COMPLETED" ? "সার্ভিস সম্পন্ন হয়েছে" : status === "CANCELLED" ? "বুকিং বাতিল হয়েছে" : "সার্ভিস চলমান",
      titleEn: status === "COMPLETED" ? "Service completed" : status === "CANCELLED" ? "Booking cancelled" : "Service in progress",
      refType: "BOOKING",
      refId: booking.id,
    });
    ok(res, updated);
  } catch (e) {
    next(e);
  }
});

const ratingSchema = z.object({ rating: z.number().int().min(1).max(5) });

bookingsRouter.post("/:id/rating", validate({ body: ratingSchema }), async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const booking = await prisma.booking.findFirst({ where: { id: req.params.id!, userId: req.auth!.userId } });
    if (!booking) throw forbidden("Not your booking");
    if (booking.status !== "COMPLETED") throw unprocessable("Only completed bookings can be rated");
    if (booking.rating != null) throw conflict("Booking already rated");

    const { rating } = req.body as { rating: number };
    // Claim-atomic: the update predicate includes the unrated state, so exactly
    // one concurrent (or repeated) submission can apply the rating. Provider
    // aggregates move only for the winning claim — a double-rating can no
    // longer inflate ratingCount/ratingSum.
    const updatedBooking = await prisma.$transaction(async (tx) => {
      const claimed = await tx.booking.updateMany({
        where: { id: booking.id, status: "COMPLETED", rating: null },
        data: { rating },
      });
      if (claimed.count !== 1) throw conflict("Booking already rated");
      if (booking.providerId) {
        await tx.serviceProvider.update({
          where: { id: booking.providerId },
          data: { ratingSum: { increment: rating }, ratingCount: { increment: 1 } },
        });
      }
      return tx.booking.findUniqueOrThrow({ where: { id: booking.id } });
    });
    ok(res, updatedBooking);
  } catch (e) {
    next(e);
  }
});
