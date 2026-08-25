import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { badRequest, unauthorized, conflict } from "../../lib/errors.js";
import { requireAuth, signAccessToken } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { audit } from "../../middleware/audit.js";
import { env, isTest } from "../../config/env.js";
import { ok } from "../../middleware/context.js";
import rateLimit from "express-rate-limit";

export const authRouter = Router();

// Brute-force protection: stricter than global limiter for auth endpoints
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "development",
  message: { ok: false, error: { code: "RATE_LIMITED", message: "Too many login attempts. Please try again later." } },
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

authRouter.post("/register", validate({ body: registerSchema }), async (req, res, next) => {
  try {
    const { fullName, phone, email, password, langPref } = req.body as z.infer<typeof registerSchema>;

    const existing = await prisma.user.findFirst({ where: { OR: [{ phone }, ...(email ? [{ email }] : [])] } });
    if (existing) throw conflict("An account with this phone/email already exists");

    const passwordHash = await bcrypt.hash(password, isTest ? 4 : 12);
    const user = await prisma.user.create({
      data: {
        fullName,
        phone,
        email,
        passwordHash,
        langPref,
        role: "FARMER", // self-service registration is farmer-only
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
    if (!stored || stored.revokedAt || stored.expiresAt < new Date() || stored.user.status !== "ACTIVE") {
      throw unauthorized("Refresh token invalid or expired");
    }

    // Rotation: revoke old token, issue a fresh one.
    await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
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
        langPref: true, status: true, createdAt: true,
        farmerProfile: { select: { membershipTier: true, district: true, upazila: true, address: true, joinedAt: true } },
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
