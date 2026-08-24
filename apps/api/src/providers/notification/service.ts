import { env } from "../../config/env.js";
import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";

export type NotificationType = "SYSTEM" | "ORDER" | "BOOKING" | "PROCUREMENT" | "PAYMENT" | "WEATHER" | "AI" | "MEMBERSHIP";

/**
 * In-app notification service. SMS/email adapters plug in here later
 * (NotificationProvider abstraction, Section 54). In-app delivery is real:
 * notifications are persisted and served via /notifications.
 */
export async function notify(params: {
  userId: string;
  type: NotificationType;
  titleBn: string;
  titleEn: string;
  bodyBn?: string;
  bodyEn?: string;
  refType?: string;
  refId?: string;
}) {
  try {
    const user = await prisma.user.findUnique({ where: { id: params.userId }, select: { langPref: true } });
    const lang = user?.langPref === "en" ? "en" : "bn";
    await prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
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
