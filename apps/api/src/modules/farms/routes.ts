import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { notFound, forbidden, badRequest, conflict } from "../../lib/errors.js";
import { ok } from "../../middleware/context.js";

export const farmsRouter = Router();

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
    const userId = req.auth!.userId;
    const role = req.auth!.role;
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
          include: { cropCycles: { where: { status: "ACTIVE" }, select: { id: true, cropName: true, stage: true, plantedAt: true } } },
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
      const member = await prisma.organizationMember.findFirst({ where: { organizationId: data.organizationId, userId: req.auth!.userId } });
      const isPrivileged = ["SUPER_ADMIN", "ADMIN"].includes(req.auth!.role);
      if (!member && !isPrivileged) throw forbidden("Not a member of the target organization");
    }
    const farm = await prisma.farm.create({
      data: { ...(data as Record<string, unknown>), ownerId: req.auth!.userId } as never,
    });
    ok(res, farm, 201);
  } catch (e) {
    next(e);
  }
});

farmsRouter.patch("/:id", validate({ body: farmBody.partial() }), async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  try {
    await assertFarmAccess(req.params.id!, req.auth!.userId, req.auth!.role);
    // organizationId is NOT patchable by owners — org linking is an
    // admin/organization flow; otherwise a farmer could attach their farm to
    // an arbitrary org and leak visibility.
    const { organizationId: _blocked, ...data } = req.body as Record<string, unknown>;
    const farm = await prisma.farm.update({ where: { id: req.params.id! }, data });
    ok(res, farm);
  } catch (e) {
    next(e);
  }
});

farmsRouter.delete("/:id", async (req, res, next) => {
  try {
    await assertFarmAccess(req.params.id!, req.auth!.userId, req.auth!.role);
    await prisma.farm.delete({ where: { id: req.params.id! } });
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
        const farm = await assertFarmAccess(req.params.id!, req.auth!.userId, req.auth!.role);
        if ((req.body as { areaBigha: number }).areaBigha > (farm.totalAreaBigha ?? Infinity)) {
          throw badRequest("Plot area exceeds total farm area");
        }
        const plot = await prisma.plot.create({ data: { ...(req.body as object), farmId: farm.id } as never });
        ok(res, plot, 201);
      } catch (e) {
        next(e);
      }
    })
    .get("/plots", async (req: import("express").Request<{ id: string }>, res, next) => {
      try {
        const farm = await assertFarmAccess(req.params.id!, req.auth!.userId, req.auth!.role);
        const plots = await prisma.plot.findMany({
          where: { farmId: farm.id },
          include: { cropCycles: { orderBy: { plantedAt: "desc" } } },
          orderBy: { createdAt: "asc" },
        });
        ok(res, plots);
      } catch (e) {
        next(e);
      }
    })
    .patch("/plots/:plotId", validate({ body: plotBody.partial() }), async (req, res, next) => {
      try {
        const farm = await assertFarmAccess(req.params.id!, req.auth!.userId, req.auth!.role);
        const existing = await prisma.plot.findFirst({ where: { id: req.params.plotId!, farmId: farm.id } });
        if (!existing) throw notFound("Plot");
        const plot = await prisma.plot.update({ where: { id: existing.id }, data: req.body as never });
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
        const plot = await prisma.plot.findUnique({ where: { id: body.plotId }, include: { farm: true } });
        if (!plot || plot.farm.ownerId !== req.auth!.userId) throw forbidden("Plot not found in your farms");

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
                farmId: plot.farmId, actorId: req.auth!.userId, type: "PLANTING",
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
        const cycles = await prisma.cropCycle.findMany({
          where: { plot: { farm: { ownerId: req.auth!.userId } } },
          include: { plot: { select: { name: true, farm: { select: { name: true } } } } },
          orderBy: { plantedAt: "desc" },
        });
        ok(res, cycles.map((c: { id: string; stage: string; plantedAt: Date; plot: { name: string; farm: { name: string } } }) => ({ ...c, stageAuto: cropStageFor(c.plantedAt), calendar: cropCalendar(c.stage) })));
      } catch (e) {
        next(e);
      }
    })
    .patch(
      "/crops/:cropId",
      validate({
        body: z
          .object({
            stage: z.enum(STAGES).optional(),
            status: z.enum(["ACTIVE", "HARVESTED", "FAILED"]).optional(),
            yieldKg: z.number().positive().max(1_000_000).optional(),
          })
.refine((b) => Object.keys(b).length > 0, { message: "No fields to update" })
      }),
      async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
        try {
          const existing = await prisma.cropCycle.findFirst({
            where: { id: req.params.cropId!, plot: { farm: { ownerId: req.auth!.userId } } },
          });
          if (!existing) throw notFound("Crop cycle");
          const updated = await prisma.cropCycle.update({ where: { id: existing.id }, data: req.body as never });
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

export function eventsRouter() {
  const router = Router({ mergeParams: true });

  const getEventsHandler = async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    try {
      const limit = Math.min(Number(req.query.limit ?? 50), 200);
      const events = await prisma.farmEvent.findMany({
        where: { farm: { ownerId: req.auth!.userId } },
        include: { plot: { select: { name: true } }, cropCycle: { select: { cropName: true } } },
        orderBy: { occurredAt: "desc" },
        take: limit,
      });
      ok(res, events);
    } catch (e) {
      next(e);
    }
  };

  const postEventHandler = async (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    try {
      const body = req.body as z.infer<typeof eventBody>;
      const farm = await prisma.farm.findFirst({ where: { id: req.params.id!, ownerId: req.auth!.userId } });
      if (!farm) throw notFound("Farm");

      if (body.clientUuid) {
        const dupe = await prisma.farmEvent.findUnique({ where: { clientUuid: body.clientUuid } });
        if (dupe) return ok(res, dupe);
      }

      const created = await prisma.farmEvent.create({
        data: {
          farmId: farm.id,
          actorId: req.auth!.userId,
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
      next(e);
    }
  };

  router.get("/events", getEventsHandler);
  router.post("/events", validate({ body: eventBody }), postEventHandler);

  return router;
}

// Mount farm-scoped sub-resources (mergeParams propagates :id into nested routers)
farmsRouter.use("/:id", plotsRouter());
farmsRouter.use("/:id", eventsRouter());
farmsRouter.use("/", cropsRouter());
