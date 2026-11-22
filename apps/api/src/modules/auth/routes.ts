import { Router } from "express";
import { z } from "zod";
import { randomBytes, randomInt, createHash } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { unauthorized, invalidCredentials, conflict, unprocessable, otpInvalid, otpExpired, forbidden, AppError } from "../../shared/errors/index.js";
import { requireAuth, signAccessToken } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { audit } from "../../middleware/audit.js";
import { isDev, isTest, env, devAuthShortcuts } from "../../config/env.js";
import { ok } from "../../middleware/context.js";
import rateLimit from "express-rate-limit";
import type { Store } from "express-rate-limit";
import { createRedisStore } from "../../lib/rateLimitRedis.js";
import { rateLimitHandler } from "../../middleware/rateLimitResponse.js";
import { logger } from "../../lib/logger.js";
import { normalizeBdPhone } from "../../shared/utils/phone.js";
import { verifyPasswordAgainst, storedHashIsCheaper } from "./password.js";
import { bcryptCost, bcryptHash } from "./bcryptPool.js";
import { accountOrIpKey, userOrIpKey, refreshKey } from "../../middleware/rateLimitKeys.js";
import { collectUserData } from "./dataExport.js";
import { removeStoredUpload } from "../../providers/storage/cleanup.js";
import { assertLoginAllowed, clearLoginFailures, recordLoginFailure } from "./accountThrottle.js";
import { otpSmsText, sendSms } from "../../providers/notification/sms.js";
import { assertStepUpOk, assertTotpLogin, consumeOtpChallenge, generateTotpSecret, otpHash, totpOtpauthUrl, verifyTotp, OTP_MAX_ATTEMPTS } from "../../lib/otp.js";
import { maskPhone, maskEmail } from "../../shared/utils/mask.js";
import { clearSessionCookies, CSRF_COOKIE, newCsrfToken, readCookie, REFRESH_COOKIE, setSessionCookies, csrfMatches } from "../../lib/sessionCookies.js";
import { stepUpEnforced } from "../../config/env.js";
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
const refreshStore = redisStoreFor("auth-refresh", 15 * 60 * 1000);
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

// Refresh limiter (SEC-01): rotation is high-entropy, so flooding it must still
// cost something — but the budget belongs to the PRESENTED TOKEN, not to the
// address. /refresh used to share loginLimiter, whose key fell back to `ip:`
// for a body that carries no phone: with 15-minute access tokens and carrier-
// grade NAT as the norm, a few dozen users on one address could spend each
// other's refresh window and log each other out mid-session (any non-OK refresh
// is a dead session to the web client). Keyed on the token fingerprint, one
// household's refreshes never touch another's; address-level floods stay on the
// global limiter.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.REFRESH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: refreshKey,
  skip: () => isDev,
  store: refreshStore,
  message: { ok: false, error: { code: "RATE_LIMITED", message: "Too many session refreshes. Please try again shortly." } },
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
// phone in the key is NORMALIZED (SEC-03): the raw body value is
// caller-controlled, so raw-keying handed `+8801…`, `8801…` and Bengali-digit
// spellings of one number separate budgets — a respelling bypass. Collapsing
// every valid spelling onto its canonical form makes the budget
// per-account-per-address; unparseable strings collapse onto one "invalid"
// segment so garbage cannot mint buckets either.
function phoneKeyedLimiter(limit: number, message: string, store: Store | undefined) {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      const raw = (req.body as { phone?: unknown } | undefined)?.phone;
      const normalized = typeof raw === "string" ? normalizeBdPhone(raw) : null;
      return `${req.ip ?? "unknown"}:${normalized ?? "invalid"}`;
    },
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
  // SEC-04: demanded only from accounts that enrolled a TOTP secret — the
  // login response says TOTP_REQUIRED first, then the code rides here.
  totp: z.string().regex(/^\d{6}$/).optional(),
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
        // F-77: auto-verification is a dev-only shortcut behind an EXPLICIT
        // opt-in (`DEV_AUTH_SHORTCUTS=1`), not merely "not production". NODE_ENV
        // defaults to development, so a deployment that omitted the variable
        // used to create pre-verified accounts with no OTP step.
        phoneVerified: devAuthShortcuts,
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

    const refreshToken = await issueRefreshToken(user.id, req.headers["user-agent"]);
    // SEC-02: the token also rides the HttpOnly ab_rt cookie (with its readable
    // CSRF pair) so browser clients can stop persisting tokens; the body copy
    // stays for the migration window (Android, request-fixture clients).
    setSessionCookies(res, refreshToken, newCsrfToken());
    ok(
      res,
      {
        accessToken: signAccessToken(user.id, user.role),
        refreshToken,
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
        // SEC-10: audit rows persist 180 days and are operator-readable — the
        // phone lands masked (normalized above, so the mask is stable).
        meta: { phone: phone ? maskPhone(phone) : null, reason: !user ? "unknown_account" : !valid ? "bad_password" : "not_active" },
      }).catch(() => undefined);
      await recordLoginFailure(throttleKey);
      throw invalidCredentials();
    }
    await clearLoginFailures(throttleKey);

    // SEC-04: TOTP for the administrator tier. Demanded only AFTER the password
    // has proven possession — a wrong-password attempt never learns whether
    // the account carries a second factor, and the 6-digit code gates the
    // session even when the password itself is compromised. The gate is a
    // throwing verifier (lib/otp.ts): the session is issued only when it
    // returns normally, the user-supplied code never appears in a route-side
    // condition, and a present-but-wrong code is audited and throttled here.
    if (user.totpEnabledAt && user.totpSecret) {
      const code = (req.body as { totp?: string }).totp ?? "";
      try {
        assertTotpLogin(user.totpSecret, code);
      } catch (e) {
        if (e instanceof AppError && e.code === "TOTP_INVALID") {
          await audit({
            action: "AUTH_LOGIN_FAILED",
            entityType: "User",
            entityId: user.id,
            ip: req.ip,
            meta: { phone: phone ? maskPhone(phone) : null, reason: "totp_invalid" },
          }).catch(() => undefined);
          await recordLoginFailure(throttleKey);
        }
        throw e;
      }
    }

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

    const refreshToken = await issueRefreshToken(user.id, req.headers["user-agent"]);
    // SEC-02: HttpOnly cookie alongside the body copy — see /refresh.
    setSessionCookies(res, refreshToken, newCsrfToken());
    ok(res, {
      accessToken: signAccessToken(user.id, user.role),
      refreshToken,
      user: { id: user.id, fullName: user.fullName, role: user.role, langPref: user.langPref },
    });
  } catch (e) {
    next(e);
  }
});

// Refresh carries its own per-token budget (SEC-01) — see refreshLimiter above.
// It must NOT share loginLimiter: that limiter's key falls back to the shared
// address for a phone-less body, which is exactly the mass-logout failure mode.
// SEC-02: the token arrives as the HttpOnly ab_rt cookie OR the request body —
// the body transport stays accepted for the Android migration window and the
// e2e request fixture; cookie-transport callers (no body token) must pass the
// CSRF double-submit (X-CSRF-Token mirroring the readable ab_csrf cookie),
// because a cross-site form/fetch can ride along with cookies but cannot read
// them to fill the header.
authRouter.post("/refresh", refreshLimiter, validate({ body: z.object({ refreshToken: z.string().min(10).max(2048).optional() }) }), async (req, res, next) => {
  try {
    const bodyToken = (req.body as { refreshToken?: string }).refreshToken;
    const cookieToken = readCookie(req, REFRESH_COOKIE);
    if (!bodyToken && !csrfMatches(req.headers["x-csrf-token"], readCookie(req, CSRF_COOKIE))) {
      throw unauthorized("Missing or invalid CSRF token");
    }
    const refreshToken = bodyToken ?? cookieToken ?? "";
    if (refreshToken.length < 10) throw unauthorized("Refresh token invalid or expired");

    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) }, include: { user: true } });
    if (!stored || stored.expiresAt < new Date() || stored.user.status !== "ACTIVE") {
      // A rejected cookie may be stale or rotated away — clear it so the next
      // boot goes to sign-in instead of retrying a dead cookie forever.
      clearSessionCookies(res);
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
      clearSessionCookies(res);
      throw unauthorized("Refresh token invalid or expired");
    }

    const newRaw = await issueRefreshToken(stored.userId, stored.deviceInfo ?? undefined);
    setSessionCookies(res, newRaw, newCsrfToken());

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
    // SEC-02: revoke whichever transport carried the token — the body value, or
    // the HttpOnly cookie when the client no longer stores tokens. The cookies
    // are cleared on every logout regardless (requireAuth's Bearer gate already
    // proves the caller is the session owner, so no CSRF header is needed
    // here: a cross-site forger cannot produce the Authorization header).
    const bodyToken = (req.body as { refreshToken?: string }).refreshToken;
    const cookieToken = readCookie(req, REFRESH_COOKIE);
    const target = bodyToken ?? cookieToken;
    if (target) {
      await prisma.refreshToken.updateMany({
        where: { tokenHash: sha256(target), userId: getAuth(req).userId },
        data: { revokedAt: new Date() },
      });
    }
    clearSessionCookies(res);
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
        // SEC-10: the row is still LOUD (a change happened, and the new
        // address remains correlatable in masked form) without storing the raw
        // address for 180 days.
        meta: { to: user.email ? maskEmail(user.email) : null },
      });
    }
    ok(res, user);
  } catch (e) {
    next(e);
  }
});

// ---------------- Phone OTP verification ----------------

const OTP_TTL_MINUTES = 5;
// OTP_MAX_ATTEMPTS and the peppered hash live in lib/otp.ts (SEC-03): the
// single implementation shared with the STEP_UP gates in lib/otp's consumers.

/**
 * Create a fresh challenge for one purpose, invalidating the user's earlier
 * unconsumed challenges OF THAT PURPOSE (a new code always retires the old).
 * Purposes stay separate so a phone-verification challenge can never be
 * consumed by the password-reset flow or vice versa.
 */
async function issueOtpChallenge(
  user: { id: string; phone: string },
  purpose: "PHONE_VERIFY" | "PASSWORD_RESET" | "STEP_UP",
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
          codeHash: otpHash(user.phone, code),
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
      ...(devAuthShortcuts ? { devCode: env.SMS_PROVIDER === "none" ? undefined : code } : {}),
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
    // Consume an attempt ATOMICALLY before comparing (SEC-03): the old
    // check-then-increment let two parallel wrong guesses both pass the
    // pre-read attempt check and exceed the cap. The conditional updateMany
    // wins or loses on the stored attempts value itself, and the row write is
    // serialized by both SQLite and PostgreSQL, so attempts can never pass the
    // cap — including the success path, which counts as the final attempt.
    const attempt = await prisma.otpChallenge.updateMany({
      where: { id: challenge.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
      data: { attempts: { increment: 1 } },
    });
    if (attempt.count === 0) {
      // Lost the conditional update: either the cap is spent or the challenge
      // was consumed/expired between the read and the write — tell those apart.
      const now = await prisma.otpChallenge.findUnique({ where: { id: challenge.id } });
      if (!now || now.consumedAt || now.expiresAt <= new Date()) {
        throw unprocessable("No active verification code. Please request a new one.");
      }
      throw unprocessable("Too many attempts. Please request a new code.");
    }

    if (challenge.codeHash !== otpHash(challenge.phone, (req.body as { code: string }).code)) {
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
      return void ok(res, { sent: true, expiresInMinutes: OTP_TTL_MINUTES, ...(devAuthShortcuts ? { devCode: code } : {}) });
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
      // Same atomic attempt consumption as /otp/verify (SEC-03): the cap is
      // enforced by the conditional update itself, not by a pre-read that
      // parallel guesses can race past.
      const attempt = await prisma.otpChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
        data: { attempts: { increment: 1 } },
      });
      if (attempt.count === 0) throw otpExpired("Too many attempts. Request a new code.");

      if (challenge.codeHash !== otpHash(challenge.phone, otp)) {
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
      // The reset revoked every refresh token — the browser's session cookies
      // reference dead tokens now, so they go too.
      clearSessionCookies(res);
      ok(res, { reset: true });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------- Step-up re-auth + TOTP enrolment (SEC-04) ----------------
/**
 * Request a STEP_UP code: the fresh SMS factor demanded by the irreversible
 * or money-moving self-service gates (withdrawals, account deletion). Same
 * challenge machinery, delivery and limiter as /otp/request; the purpose keeps
 * a step-up code from being consumed by phone verification or password reset,
 * and vice versa.
 */
authRouter.post("/otp/stepup", requireAuth, otpLimiter, async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: getAuth(req).userId } });
    if (!user) throw unauthorized();

    const { code, challenge } = await issueOtpChallenge(user, "STEP_UP");
    await sendSms(user.phone, otpSmsText(code));

    await audit({ actorId: user.id, action: "STEP_UP_REQUESTED", entityType: "User", entityId: user.id });
    ok(res, {
      sent: true,
      expiresAt: challenge.expiresAt,
      // The client adapts to this flag: enforced → show the code input; waived
      // → the gated actions proceed without it (disclosed in the startup
      // manifest until SMS delivers).
      enforced: stepUpEnforced,
      ...(devAuthShortcuts ? { devCode: env.SMS_PROVIDER === "none" ? undefined : code } : {}),
    });
  } catch (e) {
    next(e);
  }
});

// TOTP enrolment is an administrator-tier control (SEC-04): the roles that
// approve withdrawals, refunds and payouts. Self-service, opt-in per account —
// the seeded operator accounts are not enrolled, so nothing changes for them
// until an admin opts in.
const TOTP_TIER_ROLES = ["ADMIN", "SUPER_ADMIN"];

authRouter.post("/totp/enroll", requireAuth, otpLimiter, async (req, res, next) => {
  try {
    if (!TOTP_TIER_ROLES.includes(getAuth(req).role)) throw forbidden("TOTP enrolment is available to administrator accounts only");
    const user = await prisma.user.findUnique({ where: { id: getAuth(req).userId } });
    if (!user) throw unauthorized();
    if (user.totpEnabledAt) throw conflict("TOTP is already enabled — disable it before re-enrolling");

    const secret = generateTotpSecret();
    await prisma.user.update({ where: { id: user.id }, data: { totpSecret: secret } });
    await audit({ actorId: user.id, action: "TOTP_ENROLL_STARTED", entityType: "User", entityId: user.id });
    ok(res, { secret, otpauthUrl: totpOtpauthUrl(user.phone, secret) });
  } catch (e) {
    next(e);
  }
});

authRouter.post(
  "/totp/activate",
  requireAuth,
  otpLimiter,
  validate({ body: z.object({ code: z.string().regex(/^\d{6}$/) }) }),
  async (req, res, next) => {
    try {
      if (!TOTP_TIER_ROLES.includes(getAuth(req).role)) throw forbidden("TOTP enrolment is available to administrator accounts only");
      const user = await prisma.user.findUnique({ where: { id: getAuth(req).userId } });
      if (!user) throw unauthorized();
      if (user.totpEnabledAt) throw conflict("TOTP is already enabled");
      if (!user.totpSecret) throw unprocessable("No pending enrolment — start enrolment first");

      if (!verifyTotp(user.totpSecret, (req.body as { code: string }).code)) {
        throw new AppError(400, "TOTP_INVALID", "That code is not valid — check your authenticator and try again");
      }
      await prisma.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date() } });
      await audit({ actorId: user.id, action: "TOTP_ENABLED", entityType: "User", entityId: user.id });
      ok(res, { enabled: true });
    } catch (e) {
      next(e);
    }
  },
);

authRouter.post(
  "/totp/disable",
  requireAuth,
  otpLimiter,
  validate({ body: z.object({ code: z.string().regex(/^\d{6}$/) }) }),
  async (req, res, next) => {
    try {
      if (!TOTP_TIER_ROLES.includes(getAuth(req).role)) throw forbidden("TOTP enrolment is available to administrator accounts only");
      const user = await prisma.user.findUnique({ where: { id: getAuth(req).userId } });
      if (!user || !user.totpEnabledAt || !user.totpSecret) throw unprocessable("TOTP is not enabled for this account");
      // Disabling the second factor demands a valid code from it: possession
      // of the session alone must not be enough to shed the factor.
      if (!verifyTotp(user.totpSecret, (req.body as { code: string }).code)) {
        throw new AppError(400, "TOTP_INVALID", "That code is not valid — check your authenticator and try again");
      }
      await prisma.user.update({ where: { id: user.id }, data: { totpSecret: null, totpEnabledAt: null } });
      await audit({ actorId: user.id, action: "TOTP_DISABLED", entityType: "User", entityId: user.id });
      ok(res, { enabled: false });
    } catch (e) {
      next(e);
    }
  },
);

// ---------------- Account deletion (self-service) ----------------
/**
 * Anonymizes identity fields and disables the account while retaining
 * financial/ledger rows for legal integrity (see docs/data-protection.md).
 * Irreversible; blocks when an order or withdrawal is still in flight.
 *
 * What is anonymised (in the same transaction as the identity rewrite):
 *   - `User` identity and `FarmerProfile` address fields;
 *   - `Farm.address/district/upazila/lat/lng` — the farm location the privacy
 *     policy and the Play data-safety table both promise is deletable (F-12);
 *   - `FarmEvent.title/notes/metadata` for events this user authored, and
 *     `AdvisoryQuery.question/answer` — the free text the user wrote;
 *   - `Notification.body` for this user's rows (rows are kept; the body quoted
 *     order/booking details).
 * Then: OTP challenges for the pre-anonymization phone are deleted, refresh
 * tokens revoked, and the user's uploaded disease photos purged from the
 * storage provider (best-effort, logged — see below).
 *
 * Recorded residual: `AuditLog` rows keep the actor id and the request `ip`
 * for the 180-day security-trail window. Those rows are the audit of record —
 * rewriting them would weaken the trail this endpoint's own `ACCOUNT_DELETED`
 * event depends on. `LoginAttempt.phoneKey` is a salted hash (no plaintext
 * phone) and rows purge on the existing 24-hour/unlock schedule.
 */
authRouter.delete(
  "/me",
  requireAuth,
  validate({ body: z.object({ otp: z.string().regex(/^\d{6}$/).optional() }) }),
  async (req, res, next) => {
  try {
    const userId = getAuth(req).userId;
    // SEC-04 step-up: deletion is irreversible and self-service, so it demands
    // a fresh SMS factor — a stolen session (cookie or copied token) cannot
    // erase an account without the phone in the owner's hand. The gate runs
    // BEFORE the anonymisation transaction: fail cheap, count the attempt.
    // Waived while SMS is a placeholder (see the withdrawal gate + the
    // startup manifest); the Play-mandated deletion path must stay reachable.
    if (stepUpEnforced) {
      const stepUpOtp = (req.body as { otp?: string }).otp;
      if (!stepUpOtp) throw otpExpired("Request a verification code first — it arrives by SMS");
      assertStepUpOk(await consumeOtpChallenge(userId, "STEP_UP", stepUpOtp));
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { phone: true, diseaseCases: { select: { imagePath: true } } },
    });
    if (!user) throw unauthorized();

    // Checks live INSIDE the transaction with the mutation: a withdrawal
    // requested concurrently on a second session then cannot race past the
    // guard into an anonymized account.
    await prisma.$transaction(async (tx: import("@prisma/client").Prisma.TransactionClient) => {
      // Block deletion only while a lifecycle is genuinely in flight (CMP-01):
      // unpaid, pre-fulfilment states. Settled history (PAID, DELIVERED,
      // REFUNDED, CANCELLED) is retained through anonymisation below instead of
      // blocking — the old guard refused unless every order was CANCELLED or
      // the never-written "DELETED", which kept any customer who had ever paid
      // from deleting their own account (and pushed them at the PAY-06
      // hard-delete hole as the only escape).
      const inFlightOrder = await tx.order.findFirst({
        where: { userId, status: { in: ["PENDING", "CONFIRMED", "SHIPPED"] } },
      });
      if (inFlightOrder) throw unprocessable("Resolve or cancel your pending orders before deleting your account");

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
      // F-12: the same documented promise applied to the FARM.
      // `docs/data-protection.md` says account/profile data — "incl. `region`,
      // address fields" — is deleted or anonymised at deletion, and the Play
      // data-safety table marks "Physical address (farm location/GPS)"
      // Deletable: Yes. Before this the handler touched only User and
      // FarmerProfile, so a deleted user's farm address and coordinates stayed
      // queryable indefinitely. The farm ROW is retained (bookings and
      // procurement orders reference it, and those are financial records);
      // its location fields are cleared, which is the anonymisation those two
      // documents describe.
      await tx.farm.updateMany({
        where: { ownerId: userId },
        data: { address: null, district: null, upazila: null, lat: null, lng: null },
      });
      // Retained order rows keep their financial content (totals, line items),
      // but the buyer's raw shipping contact fields are masked (CMP-01
      // follow-through): docs/data-protection.md promises personal data is
      // deleted/anonymised at deletion, and settled-order rows now persist on
      // accounts with paid history instead of blocking deletion.
      await tx.order.updateMany({
        where: { userId },
        data: { shippingName: "Deleted User", shippingPhone: null, shippingAddress: null },
      });
      // The user's own words in the digital record and in advisory history.
      // AdvisoryQuery rows are retained up to 180 days by policy, and used to
      // keep the question and answer verbatim for that whole window.
      // Structured, non-personal columns (confidence, provider, kbVersion,
      // occurredAt, type) are deliberately kept — they are what makes the row
      // auditable.
      await tx.farmEvent.updateMany({
        where: { actorId: userId },
        data: { title: "[removed]", notes: null, metadataStr: null },
      });
      await tx.advisoryQuery.updateMany({
        where: { userId },
        data: { question: "[removed]", answer: "[removed]", feedbackReason: null },
      });
      // Notification bodies quote order, booking and wallet details. The row is
      // kept (the user's own surface, carrying no other account's data); the
      // body text is not.
      await tx.notification.updateMany({ where: { userId }, data: { body: "" } });
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
    // as fully deleted. Every refresh token was revoked in the transaction, so
    // the browser's session cookies are dead weight — clear them too.
    clearSessionCookies(res);
    ok(res, { deleted: true, uploads: { purged, pendingPurge: failed } });
  } catch (e) {
    next(e);
  }
});
