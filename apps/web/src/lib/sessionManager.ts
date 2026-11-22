// SessionManager — Single Auth Session Manager
// Consolidates dual token truth:
//   - lib/api.ts:31  module vars `let accessToken = localStorage.getItem("ab_at")`
//                    + `let refreshToken = localStorage.getItem("ab_rt")` (in-memory copy)
//   - lib/session.tsx:33 direct `localStorage.getItem("ab_at")` read on refresh
// This module is the ONLY owner of `ab_at` / `ab_rt` + `User` (`Session`).
// All future reads/writes (api.ts transport, session.tsx provider, refresh flow,
// 401 handler) must go through this manager instead of touching localStorage
// or module-scoped variables directly.
//
// Cross-tab sync:
//   - BroadcastChannel("agrobridge:session") — primary (same-origin tabs, instant)
//   - window "storage" event — fallback (Safari / cross-context, spec fires in
//     *other* tabs when localStorage is cleared/set)
// No visual change — pure state-ownership refactor, UI-locked.

export type Lang = "bn" | "en";

export interface SessionUser {
  userId: string;
  fullName: string;
  role: string;
  lang: Lang;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

type ChangePayload = {
  tokens: Tokens;
  session: SessionUser | null;
};

type ChangeCb = (payload: ChangePayload) => void;

// ── storage keys ────────────────────────────────────────────────────────────
// SEC-02: tokens no longer live in localStorage. Both mirrors live in
// sessionStorage — per-tab, gone when the tab closes:
//   ab_at — the access token. Restoring a reload from the mirror means a boot
//           does NOT hit /auth/refresh (which rotates), so rapid navigations
//           can never race a rotation into a reuse-detection family kill —
//           the failure mode that made a memory-only access token log users
//           out mid-journey. XSS exposure is bounded to one tab and one
//           access-token TTL (15 min), versus localStorage's forever.
//   ab_rt — the refresh token, mirroring the server's HttpOnly cookie: the
//           DOCUMENTED FALLBACK for browsers that refuse cross-site cookies
//           (Safari), so those users keep same-tab persistence.
// The audit's acceptance, "no token in localStorage", holds by construction:
// the legacy ab_at/ab_rt localStorage keys are migrated (or dropped) at module
// init and are never written again.
const AT_KEY = "ab_at"; // sessionStorage: per-tab access-token mirror
const RT_KEY = "ab_rt"; // sessionStorage: per-tab refresh-token fallback mirror
const LEGACY_AT_KEY = "ab_at"; // localStorage: legacy — migration only
const LEGACY_RT_KEY = "ab_rt"; // localStorage: legacy — migration only
const CHANNEL_NAME = "agrobridge:session" as const;

type ChannelMessage = { type: "logout" } | { type: "tokens"; tokens: Tokens } | { type: "session"; session: SessionUser | null };

// ── safe storage helpers (SSR guard) ───────────────────────────────────────
function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function canUseSessionStorage(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

function readSessionToken(key: string): string {
  if (!canUseSessionStorage()) return "";
  try {
    return window.sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeSessionToken(key: string, value: string): void {
  if (!canUseSessionStorage()) return;
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    // quota or private-mode — keep in-memory state, auth will re-establish
  }
}

// ── in-memory mirrors ──────────────────────────────────────────────────────
// Both tokens' truth is the sessionStorage mirror; reads re-check it every
// call (see getTokens) so a BroadcastChannel rotation from another tab is
// honoured without an event.
let _at = "";
let _rt = "";
let _session: SessionUser | null = null;

// SEC-02 migration: an upgrade from the localStorage era moves a still-valid
// refresh token to the per-tab mirror (when this tab has none yet) and deletes
// both legacy keys. The legacy access-token copy is dropped — a fresh one is
// minted at boot from the moved refresh token. Pure storage move — no network
// call — so a flaky boot never destroys a working session.
try {
  if (canUseStorage()) {
    const legacyRt = window.localStorage.getItem(LEGACY_RT_KEY);
    if (legacyRt && !readSessionToken(RT_KEY)) writeSessionToken(RT_KEY, legacyRt);
    window.localStorage.removeItem(LEGACY_AT_KEY);
    window.localStorage.removeItem(LEGACY_RT_KEY);
  }
} catch {
  /* ignore */
}
_at = readSessionToken(AT_KEY);
_rt = readSessionToken(RT_KEY);

// Hydrate session from storage if a previous tab persisted it.
// We do NOT auto-persist session to localStorage by default; setSession may
// optionally sync if caller wants cross-tab restore. Keep it in-memory first.
try {
  if (canUseStorage()) {
    const raw = window.localStorage.getItem("ab_session");
    if (raw) _session = JSON.parse(raw) as SessionUser;
  }
} catch {
  _session = null;
}

// ── subscribers ─────────────────────────────────────────────────────────────
const listeners = new Set<ChangeCb>();

function emit(): void {
  const payload: ChangePayload = {
    tokens: { accessToken: _at, refreshToken: _rt },
    session: _session,
  };
  for (const cb of listeners) {
    try {
      cb(payload);
    } catch {
      // subscriber error must not break manager
    }
  }
}

// ── BroadcastChannel + storage event wiring ─────────────────────────────────
let bc: BroadcastChannel | null = null;
let storageBound = false;

function getChannel(): BroadcastChannel | null {
  if (bc) return bc;
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    bc = new BroadcastChannel(CHANNEL_NAME);
    bc.onmessage = (ev: MessageEvent<ChannelMessage>) => {
      const msg = ev.data;
      if (!msg || typeof msg !== "object") return;
      if ((msg as ChannelMessage).type === "logout") {
        // Remote tab logged out — clear local mirrors without re-broadcasting
        _at = "";
        _rt = "";
        _session = null;
        if (canUseStorage()) {
          try {
            window.localStorage.removeItem(LEGACY_AT_KEY);
            window.localStorage.removeItem(LEGACY_RT_KEY);
            window.localStorage.removeItem("ab_session");
          } catch {
            /* ignore */
          }
        }
        writeSessionToken(AT_KEY, "");
        writeSessionToken(RT_KEY, "");
        emit();
      } else if ((msg as ChannelMessage).type === "tokens") {
        const t = (msg as { tokens: Tokens }).tokens;
        _at = t.accessToken ?? "";
        _rt = t.refreshToken ?? "";
        writeSessionToken(AT_KEY, _at);
        writeSessionToken(RT_KEY, _rt);
        emit();
      } else if ((msg as ChannelMessage).type === "session") {
        _session = (msg as { session: SessionUser | null }).session ?? null;
        emit();
      }
    };
  } catch {
    bc = null;
  }
  return bc;
}

function ensureStorageListener(): void {
  if (storageBound || typeof window === "undefined") return;
  storageBound = true;
  // lazily init channel too
  getChannel();
  window.addEventListener("storage", (e: StorageEvent) => {
    // Fires in *other* tabs when one tab mutates localStorage. Token rotation
    // no longer travels here (sessionStorage events never fire cross-tab) — it
    // reaches the other tabs through BroadcastChannel (getChannel) instead.
    // This listener keeps the session record in sync: ab_session holds user
    // INFO, not a credential, and a full localStorage clear is treated as
    // logout of the session record.
    if (e.key === "ab_session") {
      try {
        const raw = e.newValue;
        _session = raw ? (JSON.parse(raw) as SessionUser) : null;
        emit();
      } catch {
        /* ignore malformed */
      }
    }
    // e.key === null means clear was called — treat as session-record logout
    if (e.key === null && !_at) {
      _session = null;
      emit();
    }
  });
}

// Ensure listeners are bound eagerly in browser (not waiting for first getTokens)
if (typeof window !== "undefined") {
  ensureStorageListener();
}

// ── Public API (required interface) ───────────────────────────────────────

/**
 * Read current tokens. Single truth replaces `lib/api.ts:31` module vars
 * and `lib/session.tsx:33` direct localStorage read.
 * Always returns strings (empty if logged out).
 *
 * This DOES re-sync from localStorage on every call, deliberately — and the
 * comment here used to claim otherwise while doing the opposite. The re-read is
 * the safety net for writers this module never saw: a browser restore that
 * rehydrates storage without running the top-level read below, a test harness
 * planting `ab_at`/`ab_rt` directly, a same-tab tool clearing them. Two
 * synchronous storage reads is the price of never serving a stale token, so hot
 * paths read once per request and reuse the value (see rawRequest in api.ts)
 * instead of calling this per header.
 */
export function getTokens(): Tokens {
  // The sessionStorage re-read is the safety net for writers this module never
  // saw (same as the old localStorage re-read): a test harness planting the
  // mirror, a same-tab tool clearing it. Two synchronous reads is the price of
  // never serving a stale token; hot paths read once per request and reuse the
  // value (see rawRequest in api.ts) instead of calling this per header.
  const sAt = readSessionToken(AT_KEY);
  if (sAt !== _at) _at = sAt;
  const sRt = readSessionToken(RT_KEY);
  if (sRt !== _rt) _rt = sRt;
  return { accessToken: _at, refreshToken: _rt };
}

/**
 * Persist tokens to the per-tab sessionStorage mirrors (SEC-02 — never
 * localStorage) and notify subscribers. Also posts via BroadcastChannel so
 * other tabs update without waiting for an event.
 */
export function setTokens(at: string, rt: string): void {
  _at = at ?? "";
  _rt = rt ?? "";
  writeSessionToken(AT_KEY, _at);
  writeSessionToken(RT_KEY, _rt);
  // broadcast token rotation (optional — logout is the critical sync)
  const ch = getChannel();
  if (ch) {
    try {
      ch.postMessage({ type: "tokens", tokens: { accessToken: _at, refreshToken: _rt } } satisfies ChannelMessage);
    } catch {
      /* ignore */
    }
  }
  ensureStorageListener();
  emit();
}

/**
 * Clear tokens + session from all stores and notify.
 * Does NOT broadcast — use broadcastLogout when the intent is to log out
 * every tab. This keeps token-clear for 401 handling separate from
 * cross-tab logout semantics.
 */
export function clearTokens(): void {
  _at = "";
  _rt = "";
  writeSessionToken(AT_KEY, "");
  writeSessionToken(RT_KEY, "");
  // Belt and braces: the legacy localStorage keys are removed on every clear
  // (the init migration should have taken them, but a tab restored from
  // persisted browser storage may resurrect them).
  if (canUseStorage()) {
    try {
      window.localStorage.removeItem(LEGACY_AT_KEY);
      window.localStorage.removeItem(LEGACY_RT_KEY);
    } catch {
      /* ignore */
    }
  }
  emit();
}

export function getSession(): SessionUser | null {
  return _session;
}

export function setSession(user: SessionUser | null): void {
  _session = user;
  // Persist to localStorage for cross-tab hydration (best-effort)
  if (canUseStorage()) {
    try {
      if (user) window.localStorage.setItem("ab_session", JSON.stringify(user));
      else window.localStorage.removeItem("ab_session");
    } catch {
      /* ignore */
    }
  }
  const ch = getChannel();
  if (ch) {
    try {
      ch.postMessage({ type: "session", session: user } satisfies ChannelMessage);
    } catch {
      /* ignore */
    }
  }
  ensureStorageListener();
  emit();
}

/**
 * Subscribe to any token/session change.
 * Returns unsubscribe fn. Fires synchronously on every setTokens/clearTokens/
 * setSession/broadcastLogout and on cross-tab events (BroadcastChannel + storage).
 */
export function onChange(cb: ChangeCb): () => void {
  listeners.add(cb);
  ensureStorageListener();
  return () => {
    listeners.delete(cb);
  };
}

/**
 * Log out every tab: clears local state + storage and broadcasts
 * `{"type":"logout"}` via BroadcastChannel("agrobridge:session").
 * Relies on BroadcastChannel as primary + `storage` event fallback.
 * Caller should also call the API revoke (`POST /auth/logout`) before or after.
 */
export function broadcastLogout(): void {
  _at = "";
  _rt = "";
  _session = null;
  writeSessionToken(AT_KEY, "");
  writeSessionToken(RT_KEY, "");
  if (canUseStorage()) {
    try {
      window.localStorage.removeItem(LEGACY_AT_KEY);
      window.localStorage.removeItem(LEGACY_RT_KEY);
      window.localStorage.removeItem("ab_session");
    } catch {
      /* ignore */
    }
  }
  const ch = getChannel();
  if (ch) {
    try {
      ch.postMessage({ type: "logout" } satisfies ChannelMessage);
    } catch {
      /* ignore */
    }
  }
  emit();
}

// Migration note (historical): the "future wires" this block used to list
// have been executed for a while now - both lib/api.ts and lib/session.tsx go
// through this module, so the dual-truth bug it described is closed.