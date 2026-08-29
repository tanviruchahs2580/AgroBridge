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
    const category = typeof req.query.category === "string" ? req.query.category.toUpperCase() : undefined;
    const where = {
      userId: req.auth!.userId,
      ...(category && ["CRITICAL", "ACTION", "INFO"].includes(category) ? { category } : {}),
    };
    const [notifications, unreadCritical, unreadAction, unreadInfo] = await Promise.all([
      prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.notification.count({ where: { userId: req.auth!.userId, readAt: null, category: "CRITICAL" } }),
      prisma.notification.count({ where: { userId: req.auth!.userId, readAt: null, category: "ACTION" } }),
      prisma.notification.count({ where: { userId: req.auth!.userId, readAt: null, category: "INFO" } }),
    ]);
    ok(res, {
      items: notifications,
      unread: notifications.filter((n: { readAt: Date | null }) => !n.readAt).length,
      counts: { critical: unreadCritical, action: unreadAction, info: unreadInfo },
    });
  } catch (e) {
    next(e);
  }
});

// ---- Category preferences (which categories reach the app badge) ----

const prefsSchema = z.object({
  critical: z.boolean().default(true),
  action: z.boolean().default(true),
  info: z.boolean().default(true),
});

notificationsRouter.get("/preferences", async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId }, select: { notificationPrefs: true } });
    let prefs = { critical: true, action: true, info: true };
    if (user?.notificationPrefs) {
      try {
        prefs = { ...prefs, ...(JSON.parse(user.notificationPrefs) as Partial<typeof prefs>) };
      } catch {
        /* corrupted prefs fall back to defaults */
      }
    }
    ok(res, prefs);
  } catch (e) {
    next(e);
  }
});

notificationsRouter.patch("/preferences", validate({ body: prefsSchema }), async (req, res, next) => {
  try {
    await prisma.user.update({
      where: { id: req.auth!.userId },
      data: { notificationPrefs: JSON.stringify(req.body) },
    });
    ok(res, req.body);
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
