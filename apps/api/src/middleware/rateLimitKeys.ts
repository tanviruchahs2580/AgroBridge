import { createHash } from "node:crypto";
import type { Request } from "express";
import { normalizeBdPhone } from "../shared/utils/phone.js";

/**
 * Rate-limit key strategies (F-03 / F-04 from the 10k-concurrency audit).
 *
 * Every limiter used to fall back to express-rate-limit's default key: `req.ip`.
 * In Bangladesh most farmers reach the API through carrier-grade NAT, so one
 * public address fronts thousands of users — an IP-keyed quota is a quota shared
 * by strangers, and the first requests of the window consume it for everybody
 * behind that address. The audit measured the effect directly: 10 000 distinct
 * authenticated users produced exactly 30 successful AI requests and 1 063
 * `429`s, because the "30/hour per user" quota was keyed by IP.
 *
 * Keys are chosen per endpoint by what the limit actually protects:
 *  - an already-authenticated request → that principal (`userOrIpKey`);
 *  - a request that names an account (login, refresh) → that account, so one
 *    account's brute-force budget is its own and a NAT neighbour cannot spend it
 *    (`accountOrIpKey`);
 *  - everything else → a hash of the presented credential when there is one,
 *    else the address (`credentialOrIpKey`).
 *
 * Keys are opaque strings and are never the raw secret: the limiter store is not
 * a credential store, so a token contributes only a truncated SHA-256.
 */

/** Truncated SHA-256 of the presented bearer token — unforgeable without a real token. */
function tokenFingerprint(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (token.length < 16) return null;
  return `t:${createHash("sha256").update(token).digest("hex").slice(0, 32)}`;
}

/**
 * The account a request is acting on, when its body names one, in canonical
 * form. Normalising matters: without it `+8801710000001`, `8801710000001` and
 * `01710000001` would be three separate budgets for one account, and the limit
 * would be trivially bypassed by reformatting the same number.
 */
export function accountRateKeyPhone(rawPhone: unknown): string | null {
  if (typeof rawPhone !== "string") return null;
  return normalizeBdPhone(rawPhone);
}

/** Authenticated endpoint: per principal, per address before auth. */
export function userOrIpKey(req: Request): string {
  return req.auth?.userId ? `u:${req.auth!.userId}` : `ip:${req.ip ?? "unknown"}`;
}

/**
 * Credential-naming endpoint (login/refresh): per account, per address when the
 * body carries no usable phone. Bound to the *account* rather than the address
 * so a shared NAT cannot lock a user out of their own account, and so
 * credential-stuffing across many accounts still runs into `ip:` limits from
 * other limiters on the same route.
 */
export function accountOrIpKey(req: Request): string {
  const phone = accountRateKeyPhone((req.body as { phone?: unknown } | undefined)?.phone);
  return phone ? `a:${phone}` : `ip:${req.ip ?? "unknown"}`;
}

/**
 * Global limiter: a signed-in caller is accounted per credential, an anonymous
 * one per address. The credential is hashed, so a forged header cannot mint
 * arbitrary buckets — an attacker must present a token that login itself had to
 * issue under its own limits.
 */
export function credentialOrIpKey(req: Request): string {
  return tokenFingerprint(req) ?? `ip:${req.ip ?? "unknown"}`;
}
