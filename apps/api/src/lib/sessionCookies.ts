import { randomBytes, timingSafeEqual } from "node:crypto";
import type { CookieOptions, Request, Response } from "express";
import { env, isProd } from "../config/env.js";

/**
 * SEC-02 session cookies: the refresh token rides an HttpOnly cookie so a
 * successful XSS cannot read it out of localStorage, while the request body
 * transport stays accepted for the migration window (the Android APK and any
 * client that cannot carry cross-site cookies). Two cookies, both scoped to
 * the auth surface:
 *
 *   ab_rt   — the opaque refresh token; HttpOnly, unreadable by scripts.
 *   ab_csrf — a random token the client echoes in X-CSRF-Token; readable, so
 *             the double-submit check can run. Requests that authenticate with
 *             a body refresh token skip CSRF: possession of the secret itself
 *             is the proof, and the Android migration window plus the e2e
 *             request fixture both send that form.
 *
 * SameSite=None + Partitioned + Secure, unconditionally: the production web
 * and API sit on different Vercel domains, so the cookie is third-party from
 * the page's perspective — a SameSite=Lax cookie would never ride a
 * credentials-included XHR, and Chrome stores third-party cookies only when
 * they carry Partitioned (CHIPS), which also scopes them to the site that
 * created them. localhost is a trustworthy context in Chromium/Firefox, so the
 * unconditional Secure attribute does not break local development; where a
 * browser still refuses the cookie, the body transport keeps working and the
 * web client mirrors its refresh token in per-tab sessionStorage as the
 * documented fallback (never localStorage).
 */
export const REFRESH_COOKIE = "ab_rt";
export const CSRF_COOKIE = "ab_csrf";
const COOKIE_PATH = "/api/v1/auth";

export function newCsrfToken(): string {
  return randomBytes(16).toString("hex");
}

function cookieOptions(): CookieOptions {
  // Production serves the web and the API from different domains, so the
  // cookie is third-party there: SameSite=None + Partitioned (CHIPS) + Secure
  // is the only combination that is storable AND scoped to the site that
  // created it. Locally (the vite proxy makes web and API same-origin over
  // plain http) those flags are actively hostile — Chromium refuses
  // SameSite=None without a secure context — so the dev/test profile uses
  // plain Lax, which is strictly safer and rides the same-origin proxy fine.
  // The body transport (Android migration window, e2e request fixture) is
  // unaffected either way.
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    partitioned: isProd,
    path: COOKIE_PATH,
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}

export function setSessionCookies(res: Response, refreshToken: string, csrfToken: string): void {
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions());
  // The CSRF pair must be readable by the client on ANY document path: the
  // boot gate (hasPlausibleSession) and the double-submit header both read
  // document.cookie, which is path-filtered — a Path=/api/v1/auth cookie is
  // invisible everywhere else, and a cookie-only tab (a second tab, a new tab
  // in production) would boot as a guest with a live cookie in the jar. The
  // CSRF value is not a secret (the double-submit contract), so the wide path
  // costs nothing; ab_rt keeps the narrow auth path.
  res.cookie(CSRF_COOKIE, csrfToken, { ...cookieOptions(), httpOnly: false, path: "/" });
}

export function clearSessionCookies(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
  res.clearCookie(CSRF_COOKIE, { ...cookieOptions(), httpOnly: false, path: "/" });
}

/**
 * Minimal cookie-header reader (no parser dependency): length-capped, one
 * decode, first match wins. Refresh tokens are base64url and CSRF tokens are
 * hex — neither contains `;` or `%`-surprises, so a strict decode-or-raw is
 * sufficient and a malformed header degrades to "cookie absent".
 */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (typeof header !== "string" || header.length === 0 || header.length > 4096) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    if (raw.length === 0 || raw.length > 512) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

/** Constant-time double-submit comparison (both sides are 32-char hex). */
export function csrfMatches(headerValue: unknown, cookieValue: string | null): boolean {
  if (typeof headerValue !== "string" || headerValue.length === 0 || !cookieValue) return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(cookieValue);
  return a.length === b.length && timingSafeEqual(a, b);
}
