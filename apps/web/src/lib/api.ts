// API client: token storage, single-flight refresh, timeout + retry resilience.
// Base URL is build-time configurable so the same bundle works behind nginx
// proxy ("/api/v1") or as a Capacitor APK / cross-origin PWA ("https://api…").
//
// Token truth: all read/write goes through sessionManager (not localStorage).
// This eliminates the dual-truth bug where api.ts held stale module vars while
// session.tsx read storage directly.

import { getTokens, setTokens as smSetTokens, clearTokens as smClearTokens } from "./sessionManager";

const BASE = ((import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? "/api/v1").replace(/\/+$/, "");

// Lazy offlineQueue helpers (dynamic import avoids a circular init).
let _offlineQueue: { enqueue: (m: { url: string; method: string; body?: unknown }) => string | null; isQueueable: (method: string, url: string) => boolean } | null = null;
async function getOfflineQueue() {
  if (_offlineQueue) return _offlineQueue;
  try {
    _offlineQueue = await import("./offlineQueue");
  } catch {
    _offlineQueue = null;
  }
  return _offlineQueue;
}

export const API_BASE = BASE;

/**
 * Cold-start warm-up ping. Serverless/cold infra can take tens of seconds to
 * serve the first request after an idle period; this fire-and-forget GET at
 * app boot warms it while the user is still on the splash/login screen, so
 * the login POST itself does not time out ("internet issue" reports on the
 * APK). Errors are intentionally swallowed — this is strictly an optimization.
 */
export function wakeBackend(): void {
  if (!BASE.startsWith("http")) return; // dev proxy / same-origin: already warm
  const root = BASE.replace(/\/api\/v1$/, "");
  void fetch(`${root}/health`, { method: "GET", mode: "cors", cache: "no-store" }).catch(() => undefined);
}

export interface AuthUser {
  id: string;
  fullName: string;
  role: string;
  langPref: "bn" | "en";
}

export function setTokens(at: string, rt: string) {
  smSetTokens(at, rt);
}

export function clearTokens() {
  smClearTokens();
}

export function hasToken() {
  return Boolean(getTokens().accessToken);
}

export class ApiError extends Error {
  /** HTTP status; 0 means the request failed at network/timeout level. */
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    /** Backend-provided support/reference id from the error envelope. */
    public reference?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ── Unauthorized hook (consumed by session.tsx) ──
type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

// ── Critical-flow tracking: block session-destroy during checkout/payment ──
let criticalInProgress = false;
export function setCriticalFlow(active: boolean) {
  criticalInProgress = active;
}

/** Register the callback invoked when an authenticated session is definitively rejected (final 401). */
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null) {
  unauthorizedHandler = fn;
}

// ── Connectivity helpers ──
type OnlineCb = (online: boolean) => void;

// Module-level singleton so the offline/online window events are captured
// immediately (never lost to a React mount/effect race), and subscribers are
// notified of the *current* state on registration.
const onlineCbs = new Set<OnlineCb>();
let currentOnline = typeof navigator === "undefined" ? true : navigator.onLine !== false;

let boundWindow = false;
// Reconcile React state with navigator.onLine. Relying on window events alone
// can miss transitions (e.g. Playwright/mobile emulation flips navigator.onLine
// without always dispatching the event), so poll as a heartbeat fallback.
function setOnline(next: boolean): void {
  if (next === currentOnline) return;
  currentOnline = next;
  for (const cb of onlineCbs) cb(next);
}
function ensureWindowListener(): void {
  if (boundWindow || typeof window === "undefined") return;
  boundWindow = true;
  window.addEventListener("online", () => setOnline(true));
  window.addEventListener("offline", () => setOnline(false));
  const sync = () => setOnline(navigator.onLine !== false);
  // Reconcile immediately on bind: a transition that fired between module load
  // and this first subscription would otherwise be missed for up to 2s (or
  // forever if no further event fires — caught by the api unit suite).
  sync();
  window.addEventListener("online", sync);
  window.addEventListener("offline", sync);
  window.setInterval(sync, 2000);
}

export function isOnline(): boolean {
  ensureWindowListener();
  return currentOnline;
}

export function onOnlineStatusChange(cb: OnlineCb): () => void {
  ensureWindowListener();
  onlineCbs.add(cb);
  cb(currentOnline);
  return () => {
    onlineCbs.delete(cb);
  };
}

// ── Transport ──
// Serverless/cold infrastructure can take tens of seconds for the first call;
// wakeBackend pre-warms the function, but keep the ceiling above worst case.
const REQUEST_TIMEOUT_MS = 45_000;
const GET_RETRY_DELAYS_MS = [300, 900];
/** Ceiling for a server-directed wait, so one bad header cannot stall the UI. */
const RETRY_DELAY_CAP_MS = 10_000;

/**
 * Retry delay, jittered (F-08).
 *
 * The schedule used to be exactly 300 ms then 900 ms. Every client that failed
 * at the same moment — which is what happens when a server degrades, because
 * they all failed for the same reason at the same time — then retried at the same
 * moment, and the retries arrived as three synchronised waves that kept the
 * dependency overloaded. Widening each delay to [0.5x, 1.5x] spreads those waves
 * at no cost to the individual user.
 *
 * `Retry-After` wins when the server sent one: a 503 from the concurrency guard
 * (F-05) or a saturated database pool knows how long to wait better than a fixed
 * schedule does. The value is capped so a malformed or hostile header cannot
 * freeze the request path.
 *
 * Exported for the retry tests: asserting the delay bounds is deterministic,
 * while asserting end-to-end timing through a mocked fetch is not.
 */
export function retryDelayMs(attempt: number, res?: Response): number {
  const base = GET_RETRY_DELAYS_MS[attempt] ?? GET_RETRY_DELAYS_MS[GET_RETRY_DELAYS_MS.length - 1]!;
  const header = res?.headers?.get?.("Retry-After") ?? null;
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, RETRY_DELAY_CAP_MS) + Math.random() * 250;
    const at = Date.parse(header); // HTTP-date form
    if (!Number.isNaN(at)) {
      const delta = at - Date.now();
      if (delta > 0) return Math.min(delta, RETRY_DELAY_CAP_MS) + Math.random() * 250;
    }
  }
  return base * (0.5 + Math.random());
}

class NetworkError extends Error {
  constructor(public timedOut: boolean, message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

// ── Request correlation id ──
// Every API request carries one, so a client-side failure report can be tied to
// the server's log line for the same call. One id per *logical* request: the
// GET/5xx retry loop and the post-refresh replay of the same `api` call reuse
// the id of their first attempt, while a new request (including each offline
// queue replay) gets a fresh one. crypto.randomUUID is required; the
// getRandomValues fallback covers non-secure contexts (plain-HTTP dev hosts),
// matching offlineQueue's uuid posture — Math.random never generates these.
let requestIdFallback = 0;
function newRequestId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  if (typeof c?.getRandomValues === "function") {
    const bytes = c.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
    const hex = Array.from(bytes, (b: number) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `${Date.now().toString(36)}-${(requestIdFallback++).toString(36)}`;
}

async function rawRequest(method: string, path: string, body: unknown, requestId: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...(getTokens().accessToken ? { Authorization: `Bearer ${getTokens().accessToken}` } : {}),
        "X-Request-Id": requestId,
      },
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new NetworkError(true, `Request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw new NetworkError(false, err instanceof Error ? err.message : "Network request failed");
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** GET-only retry on network errors/timeouts/5xx with jittered backoff. Never retries 4xx.
 *  Attempts share one `requestId` — they are the same logical request. */
async function performWithRetry(method: string, path: string, body: unknown, requestId: string): Promise<Response> {
  const isGet = method.toUpperCase() === "GET";
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await rawRequest(method, path, body, requestId);
    } catch (err) {
      if (isGet && attempt < GET_RETRY_DELAYS_MS.length && err instanceof NetworkError) {
        await sleep(retryDelayMs(attempt));
        continue;
      }
      throw err;
    }
    if (isGet && attempt < GET_RETRY_DELAYS_MS.length && res.status >= 500) {
      await sleep(retryDelayMs(attempt, res));
      continue;
    }
    return res;
  }
}

function networkApiError(err: NetworkError): ApiError {
  return new ApiError(0, err.timedOut ? "NETWORK_TIMEOUT" : "NETWORK_ERROR", err.message);
}

interface Envelope {
  ok?: boolean;
  data?: unknown;
  error?: { code?: string; message?: string; details?: unknown; reference?: string };
}

function parseEnvelope(res: Response): Promise<Envelope> {
  return res.json().catch(
    (): Envelope => ({ ok: false, error: { code: "BAD_RESPONSE", message: "Malformed server response" } })
  );
}

/** Single-flight refresh to avoid stampedes on 401. */
let refreshing: Promise<boolean> | null = null;

/**
 * Refreshes the access token once, sharing the same in-flight promise as the
 * `api` 401 handler. Exposed for best-effort callers that bypass `api`
 * (analytics) so they reuse one refresh instead of stampeding the endpoint.
 */
export async function refreshAccessToken(): Promise<boolean> {
  return tryRefresh();
}

async function tryRefresh(): Promise<boolean> {
  const tokens = getTokens();
  if (!tokens.refreshToken) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Request-Id": newRequestId() },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
      if (!res.ok) return false;
      const j = await res.json();
      // Never trust a malformed refresh body: storing undefined tokens would
      // silently de-authenticate the user on the next replay.
      const at = j?.data?.accessToken;
      const rt = j?.data?.refreshToken;
      if (typeof at !== "string" || !at || typeof rt !== "string" || !rt) return false;
      setTokens(at, rt);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  const wasAuthed = Boolean(getTokens().accessToken);
  // One correlation id for this logical request: retries (5xx/network) and the
  // post-refresh replay below all reuse it.
  const requestId = newRequestId();

  // Prime offlineQueue lazy import for later sync enqueue (non-blocking)
  void getOfflineQueue();

  let res: Response;
  try {
    res = await performWithRetry(method, path, body, requestId);
  } catch (err) {
    if (err instanceof NetworkError) {
      // Queue a retry ONLY when actually offline — enqueueing a write that
      // merely timed out while online would replay it blind and duplicate
      // orders; the caller shows an error for that case instead.
      if (!isOnline()) {
        const oq = await getOfflineQueue();
        if (oq?.isQueueable(method, path)) {
          oq.enqueue({ url: path, method, body });
        }
      }
      throw networkApiError(err);
    }
    throw err;
  }

  let json = await parseEnvelope(res);

    if (res.status === 401) {
      // Try one silent refresh + replay.
      if (await tryRefresh()) {
        try {
          res = await performWithRetry(method, path, body, requestId);
          json = await parseEnvelope(res);
        } catch (err) {
          if (err instanceof NetworkError) {
            if (!isOnline()) {
              const oq = await getOfflineQueue();
              if (oq?.isQueueable(method, path)) oq.enqueue({ url: path, method, body });
            }
            throw networkApiError(err);
          }
          throw err;
        }
      }
      if (res.status === 401) {
        // Refresh failed OR replay STILL returned 401 → session is dead.
        // ── Critical-flow guard: during checkout/payment, DO NOT clear
        //    tokens or redirect. The page handles the error UX and will
        //    destroy tokens after the user dismisses the dialog. ──
        if (criticalInProgress) {
          // Throw the error so the caller can show a user-friendly message;
          // the caller will clear tokens after the user acknowledges.
          const e = new ApiError(
            res.status,
            json.error?.code ?? "UNAUTHORIZED",
            json.error?.message ?? "সেশন শেষ হয়ে গেছে / Session expired",
            json.error?.details,
            json.error?.reference
          );
          (e as { isRetryable?: boolean }).isRetryable = true;
          throw e;
        }
        clearTokens();
        if (wasAuthed) unauthorizedHandler?.();
        const msg = json.error?.message ?? "UNAUTHORIZED";
        // Return a special flag so callers can provide retry UX (checkout wizard, etc.)
        const e = new ApiError(
          res.status,
          msg === "UNAUTHORIZED" ? "UNAUTHORIZED" : json.error?.code ?? "UNAUTHORIZED",
          json.error?.message ?? "সেশন শেষ হয়ে গেছে / Session expired",
          json.error?.details,
          json.error?.reference
        );
        (e as { isRetryable?: boolean }).isRetryable = true;
        throw e;
      }
    }

  if (!res.ok || !json.ok) {
    const err = json.error ?? {};
    throw new ApiError(res.status, err.code ?? "UNKNOWN", err.message ?? "সমস্যা হয়েছে / Something went wrong", err.details, err.reference);
  }
  return json.data as T;
}
