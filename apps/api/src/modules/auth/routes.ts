import { Router } from "express";
import { z } from "zod";
import { randomBytes, randomInt, createHash } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { unauthorized, invalidCredentials, conflict, unprocessable, otpInvalid, otpExpired } from "../../shared/errors/index.js";
import { requireAuth, signAccessToken } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { audit } from "../../middleware/audit.js";
import { isDev, isProd, isTest, env } from "../../config/env.js";
import { ok } from "../../middleware/context.js";
import rateLimit from "express-rate-limit";
import type { Store } from "express-rate-limit";
import { createRedisStore } from "../../lib/rateLimitRedis.js";
import { rateLimitHandler } from "../../middleware/rateLimitResponse.js";
import { logger } from "../../lib/logger.js";
import { normalizeBdPhone } from "../../shared/utils/phone.js";
import { verifyPasswordAgainst, storedHashIsCheaper } from "./password.js";
import { bcryptCost, bcryptHash } from "./bcryptPool.js";
import { accountOrIpKey, userOrIpKey } from "../../middleware/rateLimitKeys.js";
import { collectUserData } from "./dataExport.js";
import { removeStoredUpload } from "../../providers/storage/cleanup.js";
import { assertLoginAllowed, clearLoginFailures, recordLoginFailure } from "./accountThrottle.js";
import { otpSmsText, sendSms } from "../../providers/notification/sms.js";
import { getAuth } from "../../shared/auth-context.js";

// Multi-instance-safe limiter stores. One instance per limiter, each with its own
// Redis key namespace: express-rate-limit refuses a store shared by two limiters
// (ERR_ERL_STORE_REUSE, raised on the first request through the second one), and
// the counter key it hands the store comes only from the request — so without a
// prefix every limiter on the same Redis would write the same key and share one
// budget. Four of the limiters below used to share `otpStore`, which meant OTP
// request, OTP verify, password forgot and password reset each returned 500 as
// soon as REDIS_URL was configured. Locally (no Redis) none of it was visible.
const redisStoreFor = (prefix: string, windowMs: number) =>
  env.REDIS_URL ? createRedisStore(env.REDIS_URL, windowMs, prefix) : undefined;

const loginStore = redisStoreFor("auth-login", 15 * 60 * 1000);
const otpRequestStore = redisStoreFor("auth-otp-request", 60 * 60 * 1000);
const otpVerifyStore = redisStoreFor("auth-otp-verify", 60 * 60 * 1000);
const forgotStore = redisStoreFor("auth-pw-forgot", 60 * 60 * 1000);
const resetStore = redisStoreFor("auth-pw-reset", 60 * 60 * 1000);
const registerStore = redisStoreFor("auth-register", 60 * 60 * 1000);
const exportStore = redisStoreFor("auth-me-export", 60 * 60 * 1000);

export const authRouter = Router();

// Brute-force protection: stricter than global limiter for auth endpoints.
// Keyed by the ACCOUNT the attempt names, not by address (F-04): an IP-keyed
// login budget of 20/15min is spent by whoever gets there first, so one
// neighbour behind the same carrier NAT can lock every other user out of their
// own account. Per-account keying keeps the brute-force guarantee where it
// belongs; the address-level control for unauthenticated floods remains on the
// global limiter and on registration.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.LOGIN_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: accountOrIpKey,
  skip: () => isDev,
  store: loginStore,
  message: { ok: false, error: { code: "RATE_LIMITED", message: "Too many login attempts. Please try again later." } },
  handler: rateLimitHandler,
});

// OTP request limiter: prevents SMS-pumping abuse. Keyed per authenticated user
// (F-04) — the route is authenticated, so the budget belongs to the account
// requesting codes rather than to everyone sharing its address. Mass abuse still
// meets the per-address registration limit before it can create the accounts
// this endpoint would drain.
const otpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  skip: () => isDev || isTest,
  store: otpRequestStore,
  message: { ok: false, error: { code: "RATE_LIMITED", message: "Too many OTP requests. Please try again later." } },
  handler: rateLimitHandler,
});

// OTP verify limiter: caps guesses per user even though each challenge already
// allows only 5 attempts and requesting a new code invalidates the old one.
const otpVerifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  store: otpVerifyStore,
  message: { ok: false, error: { code: "RATE_LIMITED", message: "Too many verification attempts. Please try again later." } },
  handler: rateLimitHandler,
});

// Data-export limiter: an export walks every table for one user, so it is
// deliberately rarer than login/OTP traffic (per-user key; requireAuth runs
// before it, like otpVerifyLimiter). It carries a store like every sibling: an
// in-memory window is per process, so a multi-instance deployment would serve
// five exports per user per instance instead of the documented five per hour.
const exportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: userOrIpKey,
  store: exportStore,
  message: { ok: false, error: { code: "RATE_LIMITED", message: "Too many data export requests. Please try again later." } },
  handler: rateLimitHandler,
});

// Registration limiter: prevents mass account creation abuse. Deliberately
// ADDRESS-keyed even after F-04 — this is the control that stops one actor
// minting accounts in bulk, and an account-naming key here would be supplied by
// the attacker. The NAT cost is real and accepted: the default allows a
// household, and an operator serving a genuinely large shared address can raise
// REGISTER_RATE_LIMIT_MAX rather than remove the limit.
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.REGISTER_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isDev || isTest,
  store: registerStore,
  message: { ok: false, error: { code: "RATE_LIMITED", message: "Too many registration attempts. Please try again later." } },
  handler: rateLimitHandler,
});

// Password-reset limiters: keyed by IP + the submitted phone so neither a
// single source nor a single account can pump reset SMS or grind codes. The
// phone in the key is the RAW body value — normalisation happens after the
// limiter, and keying on the raw string is what a caller controls.
function phoneKeyedLimiter(limit: number, message: string, store: Store | undefined) {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `${req.ip ?? "unknown"}:${typeof (req.body as { phone?: unknown })?.phone === "string" ? (req.body as { phone: string }).phone : ""}`,
    store,
    message: { ok: false, error: { code: "RATE_LIMITED", message } },
    handler: rateLimitHandler,
  });
}

const forgotLimiter = phoneKeyedLimiter(5, "Too many reset requests. Please try again later.", forgotStore);
const resetLimiter = phoneKeyedLimiter(10, "Too many reset attempts. Please try again later.", resetStore);

/**
 * Canonical Bangladeshi phone or 400. The transform normalises Bengali
 * digits, `+880`/`880` prefixes and spaced/dashed forms to `01[3-9]\d{8}`, so
 * the stored value and every later lookup (login, OTP) compare one string.
 */
const bdPhoneSchema = z
  .string()
  .transform((raw) => normalizeBdPhone(raw))
  .refine((value): value is string => value !== null, {
    message: "Valid Bangladeshi mobile number required (e.g., 01712345678)",
  });

/**
 * Version of the published Terms of Service + Privacy Policy a registering
 * user accepts. Mirrors LEGAL_META.version in
 * apps/web/src/features/legal/content.ts (the web app owns the documents; the
 * API records which version the user accepted in the CONSENT_CAPTURED audit
 * row). Bump both together whenever the documents change.
 */
export const POLICY_VERSION = "1.1";

const registerSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: bdPhoneSchema,
  email: z.string().email().optional(),
  password: z.string().min(8).max(72),
  langPref: z.enum(["bn", "en"]).default("bn"),
  // Consent capture (PRD-05/AUD-150): strictly true and required. A client
  // that does not send it gets 400 BAD_REQUEST by design — registration
  // without a recorded consent is no longer accepted.
  consent: z.literal(true),
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

    // Enumeration-safe duplicate handling: when the phone is already
    // registered the response is a plain success with guidance, so an attacker
    // cannot use registration as an existence oracle — nothing is created.
    // Email collisions keep the explicit 409: an email oracle is a different
    // (and rarer) disclosure surface, and a silent no-op there would strand a
    // user whose email belongs to another account.
    const existingPhone = await prisma.user.findUnique({ where: { phone } });
    if (existingPhone) {
      logger.info({ phoneMasked: `${phone.slice(0, 3)}***${phone.slice(-4)}` }, "register: number already registered — neutral response");
      return ok(res, { needsLogin: true });
    }
    if (email && (await prisma.user.findUnique({ where: { email } }))) throw conflict("An account with this email already exists");

    // Cost 12 in production, 4 under test; hashed in the worker pool so
    // registration cannot stall the event loop either (F-02).
    const passwordHash = await bcryptHash(password);
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
    // Consent is recorded as its own immutable event: which policy version the
    // user accepted at the moment the account was created (PRD-05/AUD-150).
    await audit({
      actorId: user.id,
      action: "CONSENT_CAPTURED",
      entityType: "User",
      entityId: user.id,
      ip: req.ip,
      meta: { policyVersion: POLICY_VERSION, scope: "terms+privacy" },
    });

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
    const { phone: rawPhone, password } = req.body as z.infer<typeof loginSchema>;
    // Same canonical form as registration: every valid spelling of the
    // number resolves to the one stored account.
    const phone = normalizeBdPhone(rawPhone);
    // Per-account throttle: keyed by the normalized phone — or the raw input
    // when it is not a valid number — so credential stuffing distributed
    // across addresses is bounded even when the per-IP limiter is bypassed.
    const throttleKey = phone ?? rawPhone;
    await assertLoginAllowed(throttleKey);
    const user = phone ? await prisma.user.findUnique({ where: { phone } }) : null;

    // Uniform error path avoids user enumeration — and it is uniform in TIME
    // too: an unknown phone still pays one bcrypt comparison, against
    // the module's dummy hash, before the same 401.
    const valid = await verifyPasswordAgainst(user?.passwordHash ?? null, password);
    if (!user || !valid || user.status !== "ACTIVE") {
      // Failure event for the security trail (SEC-12: failed-login audit events).
      // Write-amplification is bounded by the same limiters that bound the attempts
      // themselves: per-account login limiter plus the throttle bookkeeping plus
      // the global per-credential cap.
      await audit({
        action: "AUTH_LOGIN_FAILED",
        entityType: "User",
        entityId: user?.id ?? undefined,
        ip: req.ip,
        meta: { phone, reason: !user ? "unknown_account" : !valid ? "bad_password" : "not_active" },
      }).catch(() => undefined);
      await recordLoginFailure(throttleKey);
      throw invalidCredentials();
    }
    await clearLoginFailures(throttleKey);

    // Transparent cost upgrade (F-02 option c): a hash stored at a cheaper
    // factor than this environment uses is re-hashed at the current one, so an
    // emergency cost reduction under load — or imported legacy rows — heals
    // itself as owners return rather than weakening their accounts permanently.
    // Best-effort by design: the caller authenticated successfully, so a failed
    // upgrade must not turn login into a failure, and a lower-cost hash simply
    // remains until the next login. Current-cost hashes (all of them today) take
    // the same path and pay nothing.
    if (storedHashIsCheaper(user.passwordHash, bcryptCost())) {
      try {
        const upgraded = await bcryptHash(password);
        await prisma.user.update({ where: { id: user.id }, data: { passwordHash: upgraded } });
        logger.info({ requestId: req.requestId, userId: user.id }, "password hash upgraded to the current cost");
      } catch (e) {
        logger.warn({ requestId: req.requestId, userId: user.id, err: (e as Error).message }, "password cost upgrade deferred — retried on next login");
      }
    }

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

// Same limiter class as login: refresh issues new credentials, so flooding it
// must be expensive even though the token itself is high-entropy.
authRouter.post("/refresh", loginLimiter, validate({ body: z.object({ refreshToken: z.string().min(10).max(2048) }) }), async (req, res, next) => {
  try {
    const { refreshToken } = req.body as { refreshToken: string };

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

authRouter.post("/logout", requireAuth, validate({ body: z.object({ refreshToken: z.string().min(20).max(500).optional() }) }), async (req, res, next) => {
  try {
    const refreshToken = (req.body as { refreshToken?: string }).refreshToken;
    if (refreshToken) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: sha256(refreshToken), userId: getAuth(req).userId },
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
      where: { id: getAuth(req).userId },
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

/**
 * Personal-data export — a JSON attachment containing ONLY the
 * caller's rows (see dataExport.ts for the scoping/redaction guarantees).
 * Deliberately not wrapped in the `ok` envelope: this response IS the file.
 */
authRouter.get("/me/export", requireAuth, exportLimiter, async (req, res, next) => {
  try {
    const userId = getAuth(req).userId;
    const payload = await collectUserData(userId);
    await audit({ actorId: userId, action: "USER_DATA_EXPORTED", entityType: "User", entityId: userId, ip: req.ip });

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="agrobridge-export-${userId}.json"`);
    // A downloaded copy of everything must never sit in an intermediary cache.
    res.setHeader("Cache-Control", "no-store");
    res.send(JSON.stringify(payload, null, 2));
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
      where: { id: getAuth(req).userId },
      data: {
        ...userFields,
        farmerProfile: district || upazila || address ? { update: { district, upazila, address } } : undefined,
      },
      select: { id: true, fullName: true, email: true, langPref: true, role: true, farmerProfile: true },
    });
    await audit({ actorId: user.id, action: "PROFILE_UPDATE", entityType: "User", entityId: user.id });
    // An email swap is the one profile field an attacker would want silent:
    // no re-verification flow exists yet (login/reset are phone-first), so
    // the change is at least LOUD — its own audit row naming old → new
    // (AUD-V3 security L-10; a verification flow is tracked as the proper fix
    // if an email-bearing flow ever ships).
    if (userFields.email !== undefined) {
      await audit({
        actorId: user.id,
        action: "EMAIL_CHANGED",
        entityType: "User",
        entityId: user.id,
        meta: { to: user.email ?? null },
      });
    }
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
 * Create a fresh challenge for one purpose, invalidating the user's earlier
 * unconsumed challenges OF THAT PURPOSE (a new code always retires the old).
 * Purposes stay separate so a phone-verification challenge can never be
 * consumed by the password-reset flow or vice versa.
 */
async function issueOtpChallenge(
  user: { id: string; phone: string },
  purpose: "PHONE_VERIFY" | "PASSWORD_RESET",
): Promise<{ code: string; challenge: { expiresAt: Date } }> {
  // Supersede-then-create, retried once on the unique-index race: the partial
  // index OtpChallenge_user_purpose_live_key (one live challenge per user and
  // purpose) means two concurrent requests cannot both leave a live row —
  // the loser's create hits P2002, re-supersedes whatever won, and retries
  // exactly once (AUD-V3; previously both could go live and verification
  // picked a row nondeterministically).
  let challenge;
  let code = "";
  for (let attempt = 0; ; attempt++) {
    await prisma.otpChallenge.updateMany({
      where: { userId: user.id, purpose, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    code = String(randomInt(100000, 999999));
    try {
      challenge = await prisma.otpChallenge.create({
        data: {
          userId: user.id,
          // Already canonical `01[3-9]XXXXXXXX` (normalised at registration),
          // so hashOtp and every verify lookup compare the same string.
          phone: user.phone,
          codeHash: hashOtp(user.phone, code),
          purpose,
          expiresAt: new Date(Date.now() + OTP_TTL_MINUTES * 60_000),
        },
      });
      break;
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002" && attempt === 0) continue;
      throw e;
    }
  }
  return { code, challenge };
}

/**
 * Request an OTP for the authenticated user's own phone. The code is stored
 * hashed and delivered through the SMS provider (sandbox/none log only).
 * Outside production the code is echoed back for testability.
 *
 * requireAuth precedes the limiter so the budget can be charged to the account
 * (F-04); a request that has no valid session is rejected as 401 without
 * consuming anyone's window.
 */
authRouter.post("/otp/request", requireAuth, otpLimiter, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: getAuth(req).userId } });
    if (!user) throw unauthorized();

    const { code, challenge } = await issueOtpChallenge(user, "PHONE_VERIFY");
    await sendSms(user.phone, otpSmsText(code));

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

authRouter.post("/otp/verify", requireAuth, otpVerifyLimiter, validate({ body: z.object({ code: z.string().regex(/^\d{6}$/) }) }), async (req, res, next) => {
  try {
    const challenge = await prisma.otpChallenge.findFirst({
      where: { userId: getAuth(req).userId, purpose: "PHONE_VERIFY", consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (!challenge) throw unprocessable("No active verification code. Please request a new one.");
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) throw unprocessable("Too many attempts. Please request a new code.");

    const valid = challenge.codeHash === hashOtp(challenge.phone, (req.body as { code: string }).code);
    if (!valid) {
      await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
      throw unprocessable("Incorrect verification code");
    }

    await prisma.$transaction([
      prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } }),
      prisma.user.update({ where: { id: getAuth(req).userId }, data: { phoneVerified: true } }),
    ]);
    await audit({ actorId: getAuth(req).userId, action: "PHONE_VERIFIED", entityType: "User", entityId: getAuth(req).userId });
    ok(res, { phoneVerified: true });
  } catch (e) {
    next(e);
  }
});

// ---------------- Password reset (self-service recovery) ----------------
/**
 * Start a reset: always 200 with the same shape. When the number belongs to
 * an active account a PASSWORD_RESET challenge is created and delivered over
 * the SMS provider; otherwise nothing happens — but the response cannot be
 * used to tell those cases apart. Outside production the code is echoed for
 * tests (that echo is the only deliberate difference, and it does not exist in
 * production).
 */
authRouter.post("/password/forgot", forgotLimiter, validate({ body: z.object({ phone: bdPhoneSchema }) }), async (req, res, next) => {
  try {
    const { phone } = req.body as { phone: string };
    const user = await prisma.user.findUnique({ where: { phone } });
    if (user && user.status === "ACTIVE") {
      const { code } = await issueOtpChallenge(user, "PASSWORD_RESET");
      await sendSms(user.phone, otpSmsText(code));
      await audit({ actorId: user.id, action: "PASSWORD_RESET_REQUESTED", entityType: "User", entityId: user.id, ip: req.ip });
      return void ok(res, { sent: true, expiresInMinutes: OTP_TTL_MINUTES, ...(isProd ? {} : { devCode: code }) });
    }
    ok(res, { sent: true, expiresInMinutes: OTP_TTL_MINUTES });
  } catch (e) {
    next(e);
  }
});

/**
 * Complete a reset with the SMS code. Success rotates the password AND revokes
 * every refresh token — a reset is also the answer to "my account is
 * compromised", so it must end other sessions. The per-account login counter is
 * cleared so the reset also lifts a lockout caused by failed guesses.
 */
authRouter.post(
  "/password/reset",
  resetLimiter,
  validate({ body: z.object({ phone: bdPhoneSchema, otp: z.string().regex(/^\d{6}$/), newPassword: z.string().min(8).max(72) }) }),
  async (req, res, next) => {
    try {
      const { phone, otp, newPassword } = req.body as { phone: string; otp: string; newPassword: string };
      const user = await prisma.user.findUnique({ where: { phone } });
      const challenge = user
        ? await prisma.otpChallenge.findFirst({
            where: { userId: user.id, purpose: "PASSWORD_RESET", consumedAt: null, expiresAt: { gt: new Date() } },
            orderBy: { createdAt: "desc" },
          })
        : null;
      if (!user || user.status !== "ACTIVE" || !challenge) throw otpExpired();
      if (challenge.attempts >= OTP_MAX_ATTEMPTS) throw otpExpired("Too many attempts. Request a new code.");

      if (challenge.codeHash !== hashOtp(challenge.phone, otp)) {
        await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
        throw otpInvalid();
      }

      const passwordHash = await bcryptHash(newPassword);
      await prisma.$transaction([
        prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } }),
        prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
        prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
      ]);
      await clearLoginFailures(phone);
      await audit({ actorId: user.id, action: "PASSWORD_RESET", entityType: "User", entityId: user.id, ip: req.ip });
      ok(res, { reset: true });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------- Account deletion (self-service) ----------------
/**
 * Anonymizes identity fields and disables the account while retaining
 * financial/ledger rows for legal integrity (see docs/data-protection.md).
 * Irreversible; blocks when a withdrawal is still in flight.
 *
 * completion: also clears the location/profile fields the schema has
 * (User.region, FarmerProfile address/district/upazila/nidLast4), deletes the
 * OTP challenges for the pre-anonymization phone, and purges the user's
 * uploaded disease photos from the storage provider (best-effort, logged —
 * see below).
 */
authRouter.delete("/me", requireAuth, async (req, res, next) => {
  try {
    const userId = getAuth(req).userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, diseaseCases: { select: { imagePath: true } } },
    });
    if (!user) throw unauthorized();

    // Checks live INSIDE the transaction with the mutation: a withdrawal
    // requested concurrently on a second session then cannot race past the
    // guard into an anonymized account.
    await prisma.$transaction(async (tx: import("@prisma/client").Prisma.TransactionClient) => {
      // Block deletion if the user has active orders (financial integrity)
      const pendingOrder = await tx.order.findFirst({
        where: { userId, status: { notIn: ["CANCELLED", "DELETED"] } },
      });
      if (pendingOrder) throw unprocessable("Resolve or cancel your pending orders before deleting your account");

      const pending = await tx.withdrawal.findFirst({
        where: { userId, status: { in: ["PENDING", "APPROVED"] } },
      });
      if (pending) throw unprocessable("Resolve pending withdrawals before deleting your account");

      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      // OTP challenges are pure auth secrets keyed by the pre-anonymization
      // phone (and user); nothing about them needs retaining.
      await tx.otpChallenge.deleteMany({ where: { OR: [{ userId }, { phone: user.phone }] } });
      // Location/identity-adjacent profile fields the schema actually has.
      await tx.farmerProfile.updateMany({
        where: { userId },
        data: { address: null, district: null, upazila: null, nidLast4: null },
      });
      await tx.user.update({
        where: { id: userId },
        data: {
          fullName: "Deleted User",
          email: null,
          phone: `DEL-${userId}`,
          passwordHash: randomBytes(32).toString("hex"),
          status: "DISABLED",
          notificationPrefs: null,
          region: null,
        },
      });
    }, { timeout: 15000, maxWait: 8000 });

    // Purge stored disease photos AFTER the commit. Per-file
    // best-effort: failures are logged and counted but never block the
    // deletion — documented in docs/data-protection.md.
    let purged = 0;
    let failed = 0;
    for (const kase of user.diseaseCases) {
      const removed = await removeStoredUpload(kase.imagePath, `account-deletion:${userId}`);
      if (removed) purged++;
      else failed++;
    }
    if (failed > 0) {
      logger.warn({ userId, purged, failed, total: user.diseaseCases.length }, "account deletion: some uploaded photos were not purged");
    }

    await audit({ actorId: userId, action: "ACCOUNT_DELETED", entityType: "User", entityId: userId, ip: req.ip });
    // Honest completion: any upload whose purge failed is queued for retry
    // (scripts/purge-uploads.ts) and reported here instead of being presented
    // as fully deleted.
    ok(res, { deleted: true, uploads: { purged, pendingPurge: failed } });
  } catch (e) {
    next(e);
  }
});
