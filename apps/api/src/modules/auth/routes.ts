import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { randomBytes, randomInt, createHash } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { badRequest, unauthorized, conflict, unprocessable } from "../../lib/errors.js";
import { requireAuth, signAccessToken } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { audit } from "../../middleware/audit.js";
import { isProd, isTest, env } from "../../config/env.js";
import { ok } from "../../middleware/context.js";
import rateLimit from "express-rate-limit";
import { createRedisStore } from "../../lib/rateLimitRedis.js";

// Multi-instance-safe limiter store when REDIS_URL configured.
const sharedStore = env.REDIS_URL ? createRedisStore(env.REDIS_URL) : undefined;

export const authRouter = Router();

// Brute-force protection: stricter than global limiter for auth endpoints
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "development",
  store: sharedStore,
  message: { ok: false, error: { code: "RATE_LIMITED", message: "Too many login attempts. Please try again later." } },
});

// OTP request limiter: prevents SMS-pumping abuse
const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test",
  message: { ok: false, error: { code: "RATE_LIMITED", message: "Too many OTP requests. Please try again later." } },
});

// Registration limiter: prevents mass account creation abuse
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test",
  store: sharedStore,
  message: { ok: false, error: { code: "RATE_LIMITED", message: "Too many registration attempts. Please try again later." } },
});

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().regex(/^01[3-9]\d{8}$/, "Valid Bangladeshi mobile number required (e.g., 01712345678)"),
  email: z.string().email().optional(),
  password: z.string().min(8).max(72),
  langPref: z.enum(["bn", "en"]).default("bn"),
});

const loginSchema = z.object({
  phone: z.string().min(1),
  password: z.string().min(1),
});

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

async function issueRefreshToken(userId: string, deviceInfo?: string): Promise<string> {
  const raw = randomBytes(48).toString("hex");
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 3600 * 1000);
  await prisma.refreshToken.create({
    data: { userId, tokenHash: sha256(raw), expiresAt, deviceInfo },
  });
  return raw;
}

authRouter.post("/register", registerLimiter, validate({ body: registerSchema }), async (req, res, next) => {
  try {
    const { fullName, phone, email, password, langPref } = req.body as z.infer<typeof registerSchema>;

    const existing = await prisma.user.findFirst({ where: { OR: [{ phone }, ...(email ? [{ email }] : [])] } });
    if (existing) throw conflict("An account with this phone/email already exists");

    const passwordHash = await bcrypt.hash(password, isTest ? 4 : 12);
    // Phone is auto-verified outside production (sandbox/dev/test) so demo and
    // E2E journeys keep working; production requires the OTP flow below.
    const user = await prisma.user.create({
      data: {
        fullName,
        phone,
        email,
        passwordHash,
        langPref,
        role: "FARMER", // self-service registration is farmer-only
        phoneVerified: !isProd,
        farmerProfile: { create: {} },
        wallet: { create: {} },
      },
    });

    await audit({ actorId: user.id, action: "AUTH_REGISTER", entityType: "User", entityId: user.id, ip: req.ip });

    ok(
      res,
      {
        accessToken: signAccessToken(user.id, user.role),
        refreshToken: await issueRefreshToken(user.id, req.headers["user-agent"]),
        user: { id: user.id, fullName: user.fullName, role: user.role, langPref: user.langPref },
      },
      201
    );
  } catch (e) {
    next(e);
  }
});

authRouter.post("/login", loginLimiter, validate({ body: loginSchema }), async (req, res, next) => {
  try {
    const { phone, password } = req.body as z.infer<typeof loginSchema>;
    const user = await prisma.user.findUnique({ where: { phone } });

    // Uniform error path avoids user enumeration.
    const valid = user ? await bcrypt.compare(password, user.passwordHash) : false;
    if (!user || !valid || user.status !== "ACTIVE") throw unauthorized("Invalid credentials");

    await audit({ actorId: user.id, action: "AUTH_LOGIN", entityType: "User", entityId: user.id, ip: req.ip });

    ok(res, {
      accessToken: signAccessToken(user.id, user.role),
      refreshToken: await issueRefreshToken(user.id, req.headers["user-agent"]),
      user: { id: user.id, fullName: user.fullName, role: user.role, langPref: user.langPref },
    });
  } catch (e) {
    next(e);
  }
});

authRouter.post("/refresh", async (req, res, next) => {
  try {
    const refreshToken = (req.body?.refreshToken as string | undefined) ?? "";
    if (!refreshToken) throw badRequest("refreshToken required");

    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) }, include: { user: true } });
    if (!stored || stored.expiresAt < new Date() || stored.user.status !== "ACTIVE") {
      throw unauthorized("Refresh token invalid or expired");
    }

    // Rotation with reuse detection: the claim must win exactly once. If a
    // REVOKED token is replayed, assume theft and kill the whole family.
    const claimed = await prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count !== 1) {
      await prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw unauthorized("Refresh token invalid or expired");
    }

    const newRaw = await issueRefreshToken(stored.userId, stored.deviceInfo ?? undefined);

    ok(res, {
      accessToken: signAccessToken(stored.user.id, stored.user.role),
      refreshToken: newRaw,
    });
  } catch (e) {
    next(e);
  }
});

authRouter.post("/logout", requireAuth, async (req, res, next) => {
  try {
    const refreshToken = req.body?.refreshToken as string | undefined;
    if (refreshToken) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: sha256(refreshToken), userId: req.auth!.userId },
        data: { revokedAt: new Date() },
      });
    }
    ok(res, { loggedOut: true });
  } catch (e) {
    next(e);
  }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: {
        id: true, fullName: true, phone: true, email: true, role: true,
        langPref: true, status: true, phoneVerified: true, region: true, createdAt: true,
        farmerProfile: { select: { membershipTier: true, membershipExpiresAt: true, district: true, upazila: true, address: true, joinedAt: true } },
        wallet: { select: { balancePaisa: true } },
      },
    });
    if (!user) throw unauthorized();
    ok(res, user);
  } catch (e) {
    next(e);
  }
});

const profileSchema = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z.string().email().optional(),
  langPref: z.enum(["bn", "en"]).optional(),
  district: z.string().trim().max(60).optional(),
  upazila: z.string().trim().max(60).optional(),
  address: z.string().trim().max(300).optional(),
});

authRouter.patch("/me", requireAuth, validate({ body: profileSchema }), async (req, res, next) => {
  try {
    const { district, upazila, address, ...userFields } = req.body as z.infer<typeof profileSchema>;
    const user = await prisma.user.update({
      where: { id: req.auth!.userId },
      data: {
        ...userFields,
        farmerProfile: district || upazila || address ? { update: { district, upazila, address } } : undefined,
      },
      select: { id: true, fullName: true, email: true, langPref: true, role: true, farmerProfile: true },
    });
    await audit({ actorId: user.id, action: "PROFILE_UPDATE", entityType: "User", entityId: user.id });
    ok(res, user);
  } catch (e) {
    next(e);
  }
});

// ---------------- Phone OTP verification ----------------

const OTP_TTL_MINUTES = 5;
const OTP_MAX_ATTEMPTS = 5;

function hashOtp(phone: string, code: string): string {
  return sha256(`${phone}:${code}:${env.JWT_ACCESS_SECRET}`);
}

/**
 * Request an OTP for the authenticated user's own phone. The code is stored
 * hashed; delivery goes through the SMS provider abstraction (sandbox logs
 * it). Outside production the code is echoed back for testability.
 */
authRouter.post("/otp/request", otpLimiter, requireAuth, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
    if (!user) throw unauthorized();

    await prisma.otpChallenge.updateMany({
      where: { userId: user.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });

    const code = String(randomInt(100000, 999999));
    const challenge = await prisma.otpChallenge.create({
      data: {
        userId: user.id,
        phone: user.phone,
        codeHash: hashOtp(user.phone, code),
        expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
      },
    });

    // SMS provider adapter point: sandbox/none log only. A real gateway
    // (SSL Wireless / Alpha SMS) plugs in here behind the same call.
    if (env.SMS_PROVIDER === "sandbox") {
      const masked = `${user.phone.slice(0, 3)}***${user.phone.slice(-4)}`;
      const { logger } = await import("../../lib/logger.js");
      logger.info({ phoneMasked: masked, ttlMinutes: OTP_TTL_MINUTES }, "sms(sandbox) OTP issued");
    }

    await audit({ actorId: user.id, action: "OTP_REQUESTED", entityType: "User", entityId: user.id });
    ok(res, {
      sent: true,
      expiresAt: challenge.expiresAt,
      ...(isProd ? {} : { devCode: env.SMS_PROVIDER === "none" ? undefined : code }),
    });
  } catch (e) {
    next(e);
  }
});

authRouter.post("/otp/verify", requireAuth, validate({ body: z.object({ code: z.string().regex(/^\d{6}$/) }) }), async (req, res, next) => {
  try {
    const challenge = await prisma.otpChallenge.findFirst({
      where: { userId: req.auth!.userId, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!challenge) throw unprocessable("No active verification code. Please request a new one.");
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) throw unprocessable("Too many attempts. Please request a new code.");

    const valid = challenge.codeHash === hashOtp(challenge.phone, req.body.code as string);
    if (!valid) {
      await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      throw unprocessable("Incorrect verification code");
    }

    await prisma.$transaction([
      prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } }),
      prisma.user.update({ where: { id: req.auth!.userId }, data: { phoneVerified: true } }),
    ]);
    await audit({ actorId: req.auth!.userId, action: "PHONE_VERIFIED", entityType: "User", entityId: req.auth!.userId });
    ok(res, { phoneVerified: true });
  } catch (e) {
    next(e);
  }
});

// ---------------- Account deletion (self-service) ----------------
/**
 * Anonymizes identity fields and disables the account while retaining
 * financial/ledger rows for legal integrity (see docs/data-protection.md).
 * Irreversible; blocks when a withdrawal is still in flight.
 */
authRouter.delete("/me", requireAuth, async (req, res, next) => {
  try {
    const pending = await prisma.withdrawal.findFirst({
      where: { userId: req.auth!.userId, status: { in: ["PENDING", "APPROVED"] } },
    });
    if (pending) throw unprocessable("Resolve pending withdrawals before deleting your account");

const userId = req.auth!.userId;
    await prisma.$transaction(async (tx: import("@prisma/client").Prisma.TransactionClient) => {
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.user.update({
        where: { id: userId },
        data: {
          fullName: "Deleted User",
          email: null,
          phone: `DEL-${userId}`,
          passwordHash: randomBytes(32).toString("hex"),
          status: "DISABLED",
          notificationPrefs: null,
        },
      });
    });
    await audit({ actorId: userId, action: "ACCOUNT_DELETED", entityType: "User", entityId: userId });
    ok(res, { deleted: true });
  } catch (e) {
    next(e);
  }
});
