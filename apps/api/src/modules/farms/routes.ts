import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { notFound, forbidden, badRequest, conflict } from "../../shared/errors/index.js";
import { ok } from "../../middleware/context.js";
import { getAuth } from "../../shared/auth-context.js";

export const farmsRouter = Router();

/**
 * Nesting caps for farm-list responses (ARC-15/API-05). Pagination contract:
 * these bound ONE response — a farm's nested plots, a plot's crop cycles and
 * an events page — never the data itself; callers get more by using the
 * dedicated list endpoints (e.g. `GET /farms/:id/plots`) or, for events,
 * `?limit=` up to `eventsPerRequest`. Without the caps the nested includes were
 * unbounded, so a farm with thousands of plots (or a plot with years of
 * cycles) could return an arbitrarily large body from one request.
 */
export const FARM_LIST_CAPS = { plotsPerFarm: 50, cropCyclesPerPlot: 50, eventsPerRequest: 100 } as const;

farmsRouter.use(requireAuth);

const farmBody = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().max(300).optional(),
  district: z.string().trim().max(60).optional(),
  upazila: z.string().trim().max(60).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  totalAreaBigha: z.number().positive().max(100000).optional(),
  organizationId: z.string().min(5).optional(),
});

/** Ownership + tenant check: owner, privileged, or org member may access. */
async function assertFarmAccess(farmId: string, userId: string, role: string) {
  const farm = await prisma.farm.findUnique({ where: { id: farmId } });
  if (!farm) throw notFound("Farm");
  const isPrivileged = role === "SUPER_ADMIN" || role === "ADMIN";
  if (farm.ownerId === userId || isPrivileged) return farm;
  if (farm.organizationId) {
    const member = await prisma.organizationMember.findFirst({ where: { organizationId: farm.organizationId, userId } });
    if (member) return farm;
  }
  throw forbidden("Not your farm");
}

farmsRouter.get("/", async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const userId = getAuth(req).userId;
    const role = getAuth(req).role;
    // Corporate/cooperative see org farms; farmers see owned; admins see owned (but could see all via admin panel)
    const orgMemberships = await prisma.organizationMember.findMany({ where: { userId }, select: { organizationId: true } });
    const orgIds = orgMemberships.map((m: { organizationId: string }) => m.organizationId);
    const where: Record<string, unknown> = {};
    if (["CORPORATE", "COOPERATIVE"].includes(role) && orgIds.length > 0) {
      where.OR = [{ ownerId: userId }, { organizationId: { in: orgIds } }];
    } else if (["SUPER_ADMIN", "ADMIN"].includes(role)) {
      // admins via this endpoint still see own farms; full view via admin metrics
      where.ownerId = userId;
    } else {
      where.ownerId = userId;
    }
    const farms = await prisma.farm.findMany({
      where,
      include: {
        plots: {
          take: FARM_LIST_CAPS.plotsPerFarm,
          include: { cropCycles: { where: { status: "ACTIVE" }, take: FARM_LIST_CAPS.cropCyclesPerPlot, select: { id: true, cropName: true, stage: true, plantedAt: true, status: true } } },
        },
        _count: { select: { plots: true } },
        organization: { select: { id: true, name: true, type: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    ok(res, farms);
  } catch (e) {
    next(e);
  }
});

farmsRouter.post("/", validate({ body: farmBody }), async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    const data = req.body as z.infer<typeof farmBody>;
    if (data.organizationId) {
      const member = await prisma.organizationMember.findFirst({ where: { organizationId: data.organizationId, userId: getAuth(req).userId } });
      const isPrivileged = ["SUPER_ADMIN", "ADMIN"].includes(getAuth(req).role);
      if (!member && !isPrivileged) throw forbidden("Not a member of the target organization");
    }
    const farm = await prisma.farm.create({
      data: {
        ownerId: getAuth(req).userId,
        name: data.name,
        address: data.address,
        district: data.district,
        upazila: data.upazila,
        lat: data.lat,
        lng: data.lng,
        totalAreaBigha: data.totalAreaBigha,
        organizationId: data.organizationId,
      },
    });
    ok(res, farm, 201);
  } catch (e) {
    next(e);
  }
});

farmsRouter.patch("/:id", validate({ body: farmBody.partial() }), async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    await assertFarmAccess(req.params.id, getAuth(req).userId, getAuth(req).role);
    // organizationId is NOT patchable by owners — org linking is an
    // admin/organization flow; otherwise a farmer could attach their farm to
    // an arbitrary org and leak visibility.
    const { organizationId: _blocked, ...data } = req.body as Record<string, unknown>;
    const farm = await prisma.farm.update({ where: { id: req.params.id }, data });
    ok(res, farm);
  } catch (e) {
    next(e);
  }
});

farmsRouter.delete("/:id", async (req, res, next) => {
  try {
    await assertFarmAccess(req.params.id, getAuth(req).userId, getAuth(req).role);
    await prisma.farm.delete({ where: { id: req.params.id } });
    ok(res, { deleted: true });
  } catch (e) {
    next(e);
  }
});

// ---------------- Plots ----------------
const plotBody = z.object({
  name: z.string().trim().min(1).max(120),
  areaBigha: z.number().positive().max(10000),
  soilType: z.string().trim().max(60).optional(),
  irrigationType: z.string().trim().max(60).optional(),
});

export function plotsRouter() {
  return Router({ mergeParams: true })
    .post("/plots", validate({ body: plotBody }), async (req, res, next) => {
      try {
        const body = req.body as z.infer<typeof plotBody>;
        const farm = await assertFarmAccess(req.params.id, getAuth(req).userId, getAuth(req).role);
        // Plots collectively must fit inside the farm's declared total area.
        if (farm.totalAreaBigha != null) {
          const area = body.areaBigha;
          const others = await prisma.plot.aggregate({ where: { farmId: farm.id }, _sum: { areaBigha: true } });
          if (area + (others._sum.areaBigha ?? 0) > farm.totalAreaBigha + 1e-9) {
            throw badRequest("Plot areas would exceed the farm's total area");
          }
        }
        const plot = await prisma.plot.create({
          data: {
            farmId: farm.id,
            name: body.name,
            areaBigha: body.areaBigha,
            soilType: body.soilType,
            irrigationType: body.irrigationType,
          },
        });
        ok(res, plot, 201);
      } catch (e) {
        next(e);
      }
    })
    .get("/plots", async (req: import("express").Request<{ id: string }>, res, next) => {
      try {
        const farm = await assertFarmAccess(req.params.id, getAuth(req).userId, getAuth(req).role);
        const plots = await prisma.plot.findMany({
          where: { farmId: farm.id },
          take: FARM_LIST_CAPS.plotsPerFarm,
          include: { cropCycles: { orderBy: { plantedAt: "desc" }, take: FARM_LIST_CAPS.cropCyclesPerPlot } },
          orderBy: { createdAt: "asc" },
        });
        ok(res, plots);
      } catch (e) {
        next(e);
      }
    })
    .patch("/plots/:plotId", validate({ body: plotBody.partial() }), async (req, res, next) => {
      try {
        const farm = await assertFarmAccess(req.params.id, getAuth(req).userId, getAuth(req).role);
        const existing = await prisma.plot.findFirst({ where: { id: req.params.plotId, farmId: farm.id } });
        if (!existing) throw notFound("Plot");
        // Same shape as the validated plotBody.partial — every field optional.
        const body = req.body as Partial<z.infer<typeof plotBody>>;
        if (body.areaBigha !== undefined && farm.totalAreaBigha != null) {
          const others = await prisma.plot.aggregate({ where: { farmId: farm.id, id: { not: existing.id } }, _sum: { areaBigha: true } });
          if ((others._sum.areaBigha ?? 0) + body.areaBigha > farm.totalAreaBigha + 1e-9) {
            throw badRequest("Plot areas would exceed the farm's total area");
          }
        }
        const plot = await prisma.plot.update({
          where: { id: existing.id },
          // An omitted field must stay unchanged in the database, so only the
          // keys present in the parsed body are sent.
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.areaBigha !== undefined ? { areaBigha: body.areaBigha } : {}),
            ...(body.soilType !== undefined ? { soilType: body.soilType } : {}),
            ...(body.irrigationType !== undefined ? { irrigationType: body.irrigationType } : {}),
          },
        });
        ok(res, plot);
      } catch (e) {
        next(e);
      }
    });
}

// ---------------- Crop cycles ----------------
const cropBody = z.object({
  plotId: z.string().min(5),
  cropName: z.string().trim().min(2).max(80),
  variety: z.string().trim().max(120).optional(),
  plantedAt: z.coerce.date(),
  expectedHarvestAt: z.coerce.date().optional(),
});

const STAGES = ["SEED", "GERMINATION", "VEGETATIVE", "FLOWERING", "GRAIN_FRUIT_DEVELOPMENT", "HARVEST"] as const;

/** Crop-cycle patch body: all fields optional, but at least one required. */
const cropUpdateBody = z
  .object({
    stage: z.enum(STAGES).optional(),
    status: z.enum(["ACTIVE", "HARVESTED", "FAILED"]).optional(),
    yieldKg: z.number().positive().max(1_000_000).optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: "No fields to update" });

export function cropStageFor(plantedAt: Date, now = new Date()): string {
  // Generic lifecycle heuristic by elapsed days.
  const days = Math.floor((now.getTime() - plantedAt.getTime()) / 86400000);
  if (days <= 7) return STAGES[0];
  if (days <= 20) return STAGES[1];
  if (days <= 45) return STAGES[2];
  if (days <= 70) return STAGES[3];
  if (days <= 100) return STAGES[4];
  return STAGES[5];
}

export function cropCalendar(stage: string): { taskEn: string; taskBn: string; dueDays: number }[] {
  switch (stage) {
    case "SEED":
      return [
        { taskEn: "Ensure seedbed moisture", taskBn: "বীজতলার আর্দ্রতা নিশ্চিত করুন", dueDays: 2 },
        { taskEn: "Watch for bird/ant damage to seeds", taskBn: "পাখি/উইপোকা থেকে বীজ রক্ষা করুন", dueDays: 3 },
      ];
    case "GERMINATION":
      return [
        { taskEn: "Gap filling for missing plants", taskBn: "অনুপস্থিত চারায় গ্যাপ পূরণ", dueDays: 4 },
        { taskEn: "First weeding", taskBn: "প্রথম আগাছা পরিষ্কার", dueDays: 7 },
      ];
    case "VEGETATIVE":
      return [
        { taskEn: "Apply urea top dressing (split)", taskBn: "কিস্তিতে ইউরিয়া সেচ", dueDays: 5 },
        { taskEn: "Pest scouting twice weekly", taskBn: "সপ্তাহে দুইবার পোকা পর্যবেক্ষণ", dueDays: 3 },
      ];
    case "FLOWERING":
      return [
        { taskEn: "Maintain consistent moisture", taskBn: "নিয়মিত আর্দ্রতা বজায় রাখুন", dueDays: 2 },
        { taskEn: "Avoid pesticide spraying during bloom (protect pollinators)", taskBn: "ফুল ফোটার সময় স্প্রে এড়িয়ে চলুন", dueDays: 1 },
      ];
    case "GRAIN_FRUIT_DEVELOPMENT":
      return [
        { taskEn: "Potash top-up if leaves yellowing", taskBn: "পাতা হলদে হলে পটাশ দিন", dueDays: 6 },
        { taskEn: "Bird protection netting", taskBn: "পাখি থেকে ফসল রক্ষার জাল", dueDays: 3 },
      ];
    default:
      return [{ taskEn: "Plan harvest labour & drying floor", taskBn: "কাটাকুটি ও শুকানোর ব্যবস্থা করুন", dueDays: 5 }];
  }
}

export function cropsRouter() {
  return Router()
    .post("/crops", validate({ body: cropBody }), async (req, res, next) => {
      try {
        const body = req.body as z.infer<typeof cropBody>;
        const plot = await prisma.plot.findUnique({ where: { id: body.plotId } });
        if (!plot) throw notFound("Plot");
        // Same access rule as plots: owner, privileged, or org member.
        await assertFarmAccess(plot.farmId, getAuth(req).userId, getAuth(req).role);

        const active = await prisma.cropCycle.count({ where: { plotId: plot.id, status: "ACTIVE" } });
        if (active > 0) throw conflict("This plot already has an active crop cycle");

        const cycle = await prisma.cropCycle.create({
          data: {
            plotId: plot.id,
            cropName: body.cropName,
            variety: body.variety,
            plantedAt: body.plantedAt,
            expectedHarvestAt: body.expectedHarvestAt,
            stage: cropStageFor(body.plantedAt),
            farmEvents: {
              create: {
                farmId: plot.farmId, actorId: getAuth(req).userId, type: "PLANTING",
                title: `Planted ${body.cropName}`, occurredAt: body.plantedAt,
              },
            },
          },
        });
        ok(res, cycle, 201);
      } catch (e) {
        next(e);
      }
    })
    .get("/crops", async (req, res, next) => {
      try {
        const userId = getAuth(req).userId;
        const orgMemberships = await prisma.organizationMember.findMany({ where: { userId }, select: { organizationId: true } });
        const orgIds = orgMemberships.map((m: { organizationId: string }) => m.organizationId);
        const where = orgIds.length
          ? { OR: [{ plot: { farm: { ownerId: userId } } }, { plot: { farm: { organizationId: { in: orgIds } } } }] }
          : { plot: { farm: { ownerId: userId } } };
        const cycles = await prisma.cropCycle.findMany({
          where,
          include: { plot: { select: { name: true, farm: { select: { name: true } } } } },
          orderBy: { plantedAt: "desc" },
          take: 200,
        });
        ok(res, cycles.map((c: { id: string; stage: string; plantedAt: Date; plot: { name: string; farm: { name: string } } }) => ({ ...c, stageAuto: cropStageFor(c.plantedAt), calendar: cropCalendar(c.stage) })));
      } catch (e) {
        next(e);
      }
    })
    .patch(
      "/crops/:cropId",
      validate({ body: cropUpdateBody }),
      async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
        try {
          const existing = await prisma.cropCycle.findFirst({
            where: { id: req.params.cropId },
            include: { plot: { select: { farmId: true } } },
          });
          if (!existing) throw notFound("Crop cycle");
          // Same access rule as plots: owner, privileged, or org member.
          await assertFarmAccess(existing.plot.farmId, getAuth(req).userId, getAuth(req).role);
          const body = req.body as z.infer<typeof cropUpdateBody>;
          const updated = await prisma.cropCycle.update({
            where: { id: existing.id },
            // Omitted fields stay unchanged in the database: only keys the
            // agronomist actually sent are written.
            data: {
              ...(body.stage !== undefined ? { stage: body.stage } : {}),
              ...(body.status !== undefined ? { status: body.status } : {}),
              ...(body.yieldKg !== undefined ? { yieldKg: body.yieldKg } : {}),
            },
          });
          ok(res, updated);
        } catch (e) {
          next(e);
        }
      }
    );
}

// ---------------- Farm events (digital record) + offline sync ----------------
const eventBody = z.object({
  type: z.enum(["PLANTING", "SEED", "FERTILIZER", "IRRIGATION", "PEST", "DISEASE", "SERVICE", "HARVEST", "OTHER"]),
  title: z.string().trim().min(2).max(160),
  notes: z.string().trim().max(2000).optional(),
  plotId: z.string().optional(),
  cropCycleId: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  occurredAt: z.coerce.date().default(() => new Date()),
  clientUuid: z.string().uuid().optional(),
});

const eventQuery = z.object({
  limit: z.coerce.number().int().min(1).max(FARM_LIST_CAPS.eventsPerRequest).optional(),
});

export function eventsRouter() {
  const router = Router({ mergeParams: true });

  const getEventsHandler = async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    try {
      const userId = getAuth(req).userId;
      const orgMemberships = await prisma.organizationMember.findMany({ where: { userId }, select: { organizationId: true } });
      const orgIds = orgMemberships.map((m: { organizationId: string }) => m.organizationId);
      const where = orgIds.length
        ? { OR: [{ farm: { ownerId: userId } }, { farm: { organizationId: { in: orgIds } } }] }
        : { farm: { ownerId: userId } };
      const limitQ = eventQuery.safeParse(req.query);
      if (!limitQ.success) throw badRequest("Invalid query");
      const events = await prisma.farmEvent.findMany({
        where,
        include: { plot: { select: { name: true } }, cropCycle: { select: { cropName: true } } },
        orderBy: { occurredAt: "desc" },
        take: limitQ.data.limit ?? 50,
      });
      ok(res, events);
    } catch (e) {
      next(e);
    }
  };

  const postEventHandler = async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    try {
      const body = req.body as z.infer<typeof eventBody>;
      const farm = await prisma.farm.findFirst({ where: { id: req.params.id, ownerId: getAuth(req).userId } });
      if (!farm) throw notFound("Farm");

      // Same-farm binding: an event could previously reference any plot or
      // crop-cycle id, letting a caller attach (and later read back) another
      // user's plot name/crop through their own farm's event list.
      if (body.plotId) {
        const plot = await prisma.plot.findFirst({ where: { id: body.plotId, farmId: farm.id }, select: { id: true } });
        if (!plot) throw badRequest("plotId does not belong to this farm");
      }
      if (body.cropCycleId) {
        const cycle = await prisma.cropCycle.findFirst({
          where: { id: body.cropCycleId, plot: { farmId: farm.id } },
          select: { id: true },
        });
        if (!cycle) throw badRequest("cropCycleId does not belong to this farm");
      }

      if (body.clientUuid) {
        // Idempotent replay: return the event THIS farm+actor already stored for
        // this clientUuid. Owner-scoped on purpose — a global lookup let anyone
        // who knew another user's clientUuid read their event row and receive it
        // as the "replay" of their own submission.
        const dupe = await prisma.farmEvent.findFirst({
          where: { clientUuid: body.clientUuid, farmId: farm.id, actorId: getAuth(req).userId },
        });
        if (dupe) return ok(res, dupe);
      }

      try {
        const created = await prisma.farmEvent.create({
          data: {
            farmId: farm.id,
            actorId: getAuth(req).userId,
            type: body.type,
            title: body.title,
            notes: body.notes,
            plotId: body.plotId,
            cropCycleId: body.cropCycleId,
            metadataStr: body.metadata ? JSON.stringify(body.metadata) : undefined,
            occurredAt: body.occurredAt,
            clientUuid: body.clientUuid,
            source: "APP",
          },
        });
        ok(res, created, 201);
      } catch (e) {
        // clientUuid is globally unique; a collision here can only come from
        // another user's event (this actor's own replay returned above), so it
        // is refused rather than silently echoed back.
        if ((e as { code?: string })?.code === "P2002") {
          throw conflict("This clientUuid was already used by a different event");
        }
        throw e;
      }
    } catch (e) {
      next(e);
    }
  };

  router.get("/events", getEventsHandler);
  router.post("/events", validate({ body: eventBody }), postEventHandler);

  return router;
}

// Mount farm-scoped sub-resources (mergeParams propagates:id into nested routers)
farmsRouter.use("/:id", plotsRouter());
farmsRouter.use("/:id", eventsRouter());
farmsRouter.use("/", cropsRouter());
