import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";

export type NotificationType = "SYSTEM" | "ORDER" | "BOOKING" | "PROCUREMENT" | "PAYMENT" | "WEATHER" | "AI" | "MEMBERSHIP";
export type NotificationCategory = "CRITICAL" | "ACTION" | "INFO";

/**
 * In-app notification service. SMS/email adapters plug in here later
 * (NotificationProvider abstraction). In-app delivery is real:
 * notifications are persisted and served via /notifications.
 */
export async function notify(params: {
  userId: string;
  type: NotificationType;
  category?: NotificationCategory;
  titleBn: string;
  titleEn: string;
  bodyBn?: string;
  bodyEn?: string;
  refType?: string;
  refId?: string;
}) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { langPref: true, notificationPrefs: true },
    });
    const lang = user?.langPref === "en" ? "en" : "bn";

    // Honours the user's stored notification preferences (AUD-141): the flags the
    // preferences route persists — {critical, action, info} — decide whether this
    // category is delivered at all, not just how /notifications renders them.
    // Absent/unparseable preferences mean deliver (the historical behaviour); a
    // flag explicitly set to false opts that category out. This is a deliberate
    // silent skip, not an error state, so a preference can never fail a
    // business flow that wanted to notify.
    const prefsRaw = user?.notificationPrefs;
    if (prefsRaw) {
      try {
        const prefs = JSON.parse(prefsRaw) as { critical?: boolean; action?: boolean; info?: boolean };
        const category = (params.category ?? "INFO") as "CRITICAL" | "ACTION" | "INFO";
        const key = category.toLowerCase() as "critical" | "action" | "info";
        if (prefs[key] === false) {
          logger.info({ userId: params.userId, category }, "notification suppressed by user preference");
          return;
        }
      } catch {
        /* unparseable prefs fall back to deliver */
      }
    }

    await prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        category: params.category ?? "INFO",
        title: lang === "bn" ? params.titleBn : params.titleEn,
        body:
          (lang === "bn" ? params.bodyBn : params.bodyEn) ??
          (lang === "bn" ? params.titleBn : params.titleEn),
        refType: params.refType,
        refId: params.refId,
      },
    });
    if (env.SMS_PROVIDER === "sandbox") {
      logger.info({ userId: params.userId, type: params.type }, "sms(sandbox) notification delivered in-app only");
    }
  } catch (e) {
    logger.warn({ err: (e as Error).message }, "notification persist failed");
  }
}
