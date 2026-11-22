import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "./prisma.js";
import { deriveSubkey } from "../shared/utils/kdf.js";
import { AppError } from "../shared/errors/index.js";
import { env } from "../config/env.js";

/**
 * The OTP/TOTP core, shared by the auth module (phone verification, password
 * reset, step-up issuance) and the money-path re-auth gates (SEC-04).
 *
 * OTP challenges: hashed with a domain-separated HKDF subkey of
 * JWT_ACCESS_SECRET (SEC-03 — see shared/utils/kdf.ts), attempts consumed by
 * ONE atomic conditional update before the code comparison, so parallel
 * guesses can never exceed the cap on either engine.
 */

export const OTP_MAX_ATTEMPTS = 5;

// Domain-separated OTP pepper (SEC-03): this used to be JWT_ACCESS_SECRET
// itself, reusing the token-signing key as a hash pepper. One-time deploy
// effect (documented in shared/utils/kdf.ts): in-flight challenges invalidate.
const OTP_PEPPER = deriveSubkey(env.JWT_ACCESS_SECRET, "otp-hash-v1");

export function otpHash(phone: string, code: string): string {
  return createHash("sha256").update(`${phone}:${code}:${OTP_PEPPER}`).digest("hex");
}

/**
 * Consume one live challenge of `purpose` for `userId`: the atomic attempt
 * budget is spent BEFORE the code comparison (the SEC-03 race fix), and a
 * correct code marks the challenge consumed. Returns a discriminated outcome —
 * callers map it to their own error envelope.
 */
export async function consumeOtpChallenge(
  userId: string,
  purpose: "PHONE_VERIFY" | "PASSWORD_RESET" | "STEP_UP",
  code: string,
): Promise<"ok" | "no_active" | "too_many" | "invalid"> {
  const challenge = await prisma.otpChallenge.findFirst({
    where: { userId, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) return "no_active";
  const attempt = await prisma.otpChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null, attempts: { lt: OTP_MAX_ATTEMPTS } },
    data: { attempts: { increment: 1 } },
  });
  if (attempt.count === 0) return "too_many";
  if (challenge.codeHash !== otpHash(challenge.phone, code)) return "invalid";
  await prisma.otpChallenge.update({ where: { id: challenge.id }, data: { consumedAt: new Date() } });
  return "ok";
}

// ── TOTP (RFC 6238): SHA-1, 6 digits, 30 s step, ±1 window ─────────────────
// node:crypto only — no authenticator dependency. The secret is base32 (RFC
// 4648, no padding), the encoding every authenticator app expects in the
// otpauth URL.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error("invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpAt(secret: string, timeStep: number): string {
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(timeStep));
  const digest = createHmac("sha1", key).update(counter).digest();
  // RFC 2104: offset = last nibble of the digest; the 31-bit big-endian read
  // spans offset..offset+3, always inside the 20-byte HMAC-SHA1 output.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

/** Constant-time verification with a ±1 step window (clock drift tolerance). */
export function verifyTotp(secret: string, code: string, nowMs = Date.now()): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const step = Math.floor(nowMs / 30_000);
  for (const drift of [0, -1, 1]) {
    if (timingSafeEqual(Buffer.from(totpAt(secret, step + drift)), Buffer.from(code))) return true;
  }
  return false;
}

export function totpOtpauthUrl(phone: string, secret: string): string {
  return `otpauth://totp/AgroBridge:${encodeURIComponent(phone)}?issuer=AgroBridge&secret=${secret}&algorithm=SHA1&digits=6&period=30`;
}

/**
 * Login-time TOTP gate (SEC-04): throwing, not boolean, so the caller's
 * continuation is guarded by exception flow — the session is issued only when
 * this returns normally, and the user-supplied code never appears in a
 * caller-side condition. An absent code fails the verifier (it cannot match
 * the six-digit shape) and answers TOTP_REQUIRED without touching the failure
 * counters — nothing was guessed — while a present-but-wrong code fails as
 * TOTP_INVALID for the caller to audit and throttle.
 */
export function assertTotpLogin(secret: string, code: string): void {
  if (!/^\d{6}$/.test(code)) {
    throw new AppError(401, "TOTP_REQUIRED", "Enter the 6-digit code from your authenticator app");
  }
  if (!verifyTotp(secret, code)) {
    throw new AppError(401, "TOTP_INVALID", "That code is not valid — check your authenticator and try again");
  }
}

/**
 * Map a step-up gate outcome to its user-facing 422. Distinct machine codes
 * (OTP_EXPIRED / OTP_INVALID) keep the web's bilingual mapping working; the
 * messages are deliberate about the remedy (request a new code).
 */
export function assertStepUpOk(outcome: "ok" | "no_active" | "too_many" | "invalid"): void {
  if (outcome === "ok") return;
  if (outcome === "no_active") {
    throw new AppError(422, "OTP_EXPIRED", "No active verification code — request a new one and try again");
  }
  if (outcome === "too_many") {
    throw new AppError(422, "OTP_EXPIRED", "Too many attempts — request a new verification code");
  }
  throw new AppError(422, "OTP_INVALID", "That verification code is not valid — check the SMS and try again");
}
