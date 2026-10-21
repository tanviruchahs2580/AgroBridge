import { createHash } from "node:crypto";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { accountLocked } from "../../shared/errors/index.js";

/**
 * Per-account login throttling (complements the per-IP limiter on /login).
 *
 * IP-keyed limits alone do not stop credential stuffing distributed across
 * addresses against one account. The counter is keyed by a salted hash of the
 * normalized phone — never the number itself — so the table holds no PII and
 * works identically for phone numbers that have no account (an unknown number
 * that fails ten times is "locked" the same way, which keeps the lock message
 * from becoming an existence oracle).
 *
 * A lock lasts LOCK_MINUTES; when it expires the counter resets lazily so a
 * single later typo does not immediately re-lock the account.
 */
const MAX_FAILURES = 10;
const LOCK_MINUTES = 15;

function phoneKey(phone: string): string {
  return createHash("sha256").update(`login:${phone}:${env.JWT_ACCESS_SECRET}`).digest("hex");
}

/** Throws 429 when the account (or the unknown number) is inside a lock window. */
export async function assertLoginAllowed(phone: string): Promise<void> {
  const key = phoneKey(phone);
  const row = await prisma.loginAttempt.findUnique({ where: { phoneKey: key } });
  if (!row) return;
  if (row.lockedUntil && row.lockedUntil > new Date()) throw accountLocked();
  if (row.lockedUntil) {
    // Lock expired: give the next window a clean slate.
    await prisma.loginAttempt.update({ where: { phoneKey: key }, data: { count: 0, lockedUntil: null } });
  }
}

export async function recordLoginFailure(phone: string): Promise<void> {
  const key = phoneKey(phone);
  const row = await prisma.loginAttempt.upsert({
    where: { phoneKey: key },
    create: { phoneKey: key, count: 1 },
    update: { count: { increment: 1 } },
  });
  if (row.count >= MAX_FAILURES) {
    await prisma.loginAttempt.update({
      where: { phoneKey: key },
      data: { lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60_000) },
    });
  }
}

/** Clears the counter after a successful login (or a completed password reset). */
export async function clearLoginFailures(phone: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { phoneKey: phoneKey(phone) } });
}

export const LOGIN_THROTTLE = { MAX_FAILURES, LOCK_MINUTES } as const;
