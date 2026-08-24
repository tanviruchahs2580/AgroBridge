import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../lib/prisma.js";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { ok } from "../../middleware/context.js";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get("/", async (req, res, next) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.auth!.userId },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const unread = notifications.filter((n) => !n.readAt).length;
    ok(res, { items: notifications, unread });
  } catch (e) {
    next(e);
  }
});

notificationsRouter.post(
  "/read",
  validate({ body: z.object({ ids: z.array(z.string()).max(200).optional(), all: z.boolean().optional() }) }),
  async (req, res, next) => {
    try {
      const { ids, all } = req.body as { ids?: string[]; all?: boolean };
      if (all) {
        await prisma.notification.updateMany({ where: { userId: req.auth!.userId, readAt: null }, data: { readAt: new Date() } });
      } else if (ids?.length) {
        await prisma.notification.updateMany({ where: { userId: req.auth!.userId, id: { in: ids } }, data: { readAt: new Date() } });
      }
      ok(res, { updated: true });
    } catch (e) {
      next(e);
    }
  }
);
