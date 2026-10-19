import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";

export type NotificationType = "SYSTEM" | "ORDER" | "BOOKING" | "PROCUREMENT" | "PAYMENT" | "WEATHER" | "AI" | "MEMBERSHIP";
export type NotificationCategory = "CRITICAL" | "ACTION" | "INFO";

/**
 * In-app notification service. In-app delivery is real: notifications are
 * persisted and served via /notifications; SMS delivery for OTP lives in
 * providers/notification/sms.ts.
 *
 * Category preferences (`User.notificationPrefs`, edited at
 * /notifications/preferences) are honoured here — before this was wired, the
 * toggles persisted but changed nothing. Security/account-critical messages
 * pass `bypassPrefs` so a user cannot silence, e.g., a forced password change.
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
  bypassPrefs?: boolean;
}) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: params.userId },
      select: { langPref: true, notificationPrefs: true },
    });
    const lang = user?.langPref === "en" ? "en" : "bn";
    const category = params.category ?? "INFO";
    if (!params.bypassPrefs && user?.notificationPrefs) {
      let prefs: Partial<Record<"critical" | "action" | "info", boolean>> = {};
      try {
        prefs = JSON.parse(user.notificationPrefs) as typeof prefs;
      } catch {
        // Corrupted prefs fall back to "deliver" — never lose a notification
        // because its preference blob could not be read.
      }
      const key = category.toLowerCase() as "critical" | "action" | "info";
      if (prefs[key] === false) {
        logger.debug({ userId: params.userId, type: params.type, category }, "notification suppressed by user preference");
        return;
      }
    }
    await prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        category,
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
