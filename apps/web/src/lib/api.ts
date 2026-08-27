// API client: token storage, single-flight refresh, timeout + retry resilience.
// Base URL is build-time configurable so the same bundle works behind nginx
// proxy ("/api/v1") or as a Capacitor APK / cross-origin PWA ("https://api…").
const BASE = ((import.meta.env?.VITE_API_BASE_URL as string | undefined) ?? "/api/v1").replace(/\/+$/, "");

// STEP 55: lazy offlineQueue helpers to avoid circular init issues — imported dynamically inside api()
let _offlineQueue: { enqueue: (m: { url: string; method: string; body?: unknown }) => string | null; isQueueable: (url: string) => boolean } | null = null;
async function getOfflineQueue() {
  if (_offlineQueue) return _offlineQueue;
  try {
    _offlineQueue = await import("./offlineQueue.js");
  } catch {
    _offlineQueue = null;
  }
  return _offlineQueue;
}
function trySyncEnqueue(url: string, method: string, body?: unknown) {
  // Synchronous try — if offlineQueue already loaded, enqueue immediately; otherwise rely on async path via api caller
  if (_offlineQueue?.isQueueable(url)) _offlineQueue.enqueue({ url, method, body });
}

export const API_BASE = BASE;

export interface AuthUser {
  id: string;
  fullName: string;
  role: string;
  langPref: "bn" | "en";
}

let accessToken = localStorage.getItem("ab_at") ?? "";
let refreshToken = localStorage.getItem("ab_rt") ?? "";

export function setTokens(at: string, rt: string) {
  accessToken = at;
  refreshToken = rt;
  localStorage.setItem("ab_at", at);
  localStorage.setItem("ab_rt", rt);
}

export function clearTokens() {
  accessToken = "";
  refreshToken = "";
  localStorage.removeItem("ab_at");
  localStorage.removeItem("ab_rt");
}

export function hasToken() {
  return Boolean(accessToken);
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
const REQUEST_TIMEOUT_MS = 10_000;
const GET_RETRY_DELAYS_MS = [300, 900];

class NetworkError extends Error {
  constructor(public timedOut: boolean, message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

async function rawRequest(method: string, path: string, body?: unknown): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
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

/** GET-only retry on network errors/timeouts/5xx with exponential backoff. Never retries 4xx. */
async function performWithRetry(method: string, path: string, body?: unknown): Promise<Response> {
  const isGet = method.toUpperCase() === "GET";
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await rawRequest(method, path, body);
    } catch (err) {
      if (isGet && attempt < GET_RETRY_DELAYS_MS.length && err instanceof NetworkError) {
        await sleep(GET_RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw err;
    }
    if (isGet && attempt < GET_RETRY_DELAYS_MS.length && res.status >= 500) {
      await sleep(GET_RETRY_DELAYS_MS[attempt]);
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
async function tryRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const j = await res.json();
      setTokens(j.data.accessToken, j.data.refreshToken);
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
  const wasAuthed = Boolean(accessToken);

  // Prime offlineQueue lazy import for later sync enqueue (non-blocking)
  void getOfflineQueue();

  let res: Response;
  try {
    res = await performWithRetry(method, path, body);
  } catch (err) {
    if (err instanceof NetworkError) {
      // STEP 55: if offline and queueable, enqueue for later replay
      if (!isOnline()) {
        const oq = await getOfflineQueue();
        if (oq?.isQueueable(path)) {
          oq.enqueue({ url: path, method, body });
        }
      } else {
        trySyncEnqueue(path, method, body);
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
        res = await performWithRetry(method, path, body);
        json = await parseEnvelope(res);
      } catch (err) {
        if (err instanceof NetworkError) {
          if (!isOnline()) {
            const oq = await getOfflineQueue();
            if (oq?.isQueueable(path)) oq.enqueue({ url: path, method, body });
          }
          throw networkApiError(err);
        }
        throw err;
      }
    }
    if (res.status === 401) {
      // Refresh failed OR replay STILL returned 401 → session is dead.
      // Clear tokens and notify the app layer (previously tokens were kept).
      clearTokens();
      if (wasAuthed) unauthorizedHandler?.();
      throw new ApiError(
        res.status,
        json.error?.code ?? "UNAUTHORIZED",
        json.error?.message ?? "সেশন শেষ হয়ে গেছে / Session expired",
        json.error?.details,
        json.error?.reference
      );
    }
  }

  if (!res.ok || !json.ok) {
    const err = json.error ?? {};
    throw new ApiError(res.status, err.code ?? "UNKNOWN", err.message ?? "সমস্যা হয়েছে / Something went wrong", err.details, err.reference);
  }
  return json.data as T;
}
