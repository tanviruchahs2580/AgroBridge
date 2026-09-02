// SessionManager — Single Auth Session Manager (Phase 8)
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
const AT_KEY = "ab_at" as const;
const RT_KEY = "ab_rt" as const;
const CHANNEL_NAME = "agrobridge:session" as const;

type ChannelMessage = { type: "logout" } | { type: "tokens"; tokens: Tokens } | { type: "session"; session: SessionUser | null };

// ── safe localStorage helpers (SSR guard) ─────────────────────────────────
function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStorage(key: string): string {
  if (!canUseStorage()) return "";
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function writeStorage(key: string, value: string): void {
  if (!canUseStorage()) return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // quota or private-mode — keep in-memory state, auth will re-establish
  }
}

// ── in-memory mirrors (single truth, hydrated from storage once) ──────────
let _at: string = readStorage(AT_KEY);
let _rt: string = readStorage(RT_KEY);
let _session: SessionUser | null = null;

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
            window.localStorage.removeItem(AT_KEY);
            window.localStorage.removeItem(RT_KEY);
            window.localStorage.removeItem("ab_session");
          } catch {
            /* ignore */
          }
        }
        emit();
      } else if ((msg as ChannelMessage).type === "tokens") {
        const t = (msg as { tokens: Tokens }).tokens;
        _at = t.accessToken ?? "";
        _rt = t.refreshToken ?? "";
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
    // Fires in *other* tabs when one tab mutates localStorage.
    // Detect logout (ab_at removed) or token rotation.
    if (e.key === AT_KEY || e.key === RT_KEY || e.key === null) {
      const nextAt = readStorage(AT_KEY);
      const nextRt = readStorage(RT_KEY);
      // Only emit if something actually changed (avoid loops)
      if (nextAt !== _at || nextRt !== _rt) {
        _at = nextAt;
        _rt = nextRt;
        // If ab_at was cleared externally, treat as logout — also clear session
        if (!_at) _session = null;
        emit();
      }
    }
    if (e.key === "ab_session") {
      try {
        const raw = e.newValue;
        _session = raw ? (JSON.parse(raw) as SessionUser) : null;
        emit();
      } catch {
        /* ignore malformed */
      }
    }
    // e.key === null means clear() was called — treat as full logout
    if (e.key === null && !readStorage(AT_KEY) && !_at) {
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
 */
export function getTokens(): Tokens {
  // Re-sync from storage defensively (covers external mutation without event)
  // but prefer in-memory value for speed.
  if (canUseStorage()) {
    // lazy re-read only if in-memory is empty but storage has value (tab restored)
    const sAt = readStorage(AT_KEY);
    const sRt = readStorage(RT_KEY);
    if (sAt !== _at || sRt !== _rt) {
      _at = sAt;
      _rt = sRt;
    }
  }
  return { accessToken: _at, refreshToken: _rt };
}

/**
 * Persist tokens to in-memory + localStorage and notify subscribers.
 * Also posts via BroadcastChannel so other tabs can update without waiting
 * for the storage event.
 */
export function setTokens(at: string, rt: string): void {
  _at = at ?? "";
  _rt = rt ?? "";
  writeStorage(AT_KEY, _at);
  writeStorage(RT_KEY, _rt);
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
 * Does NOT broadcast — use broadcastLogout() when the intent is to log out
 * every tab. This keeps token-clear for 401 handling separate from
 * cross-tab logout semantics.
 */
export function clearTokens(): void {
  _at = "";
  _rt = "";
  writeStorage(AT_KEY, "");
  writeStorage(RT_KEY, "");
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
  if (canUseStorage()) {
    try {
      window.localStorage.removeItem(AT_KEY);
      window.localStorage.removeItem(RT_KEY);
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

// ── Migration note ─────────────────────────────────────────────────────────
// Future wires (not executed in this doc-only phase, to respect "do not modify
// existing source"):
//   lib/api.ts — replace `let accessToken = localStorage.getItem("ab_at")`
//                with `import { getTokens, setTokens, clearTokens } from "./sessionManager.js"`
//                and read `getTokens().accessToken` inside rawRequest/tryRefresh.
//   lib/session.tsx — replace `if (!localStorage.getItem("ab_at"))` (line 33)
//                    with `if (!getTokens().accessToken)` and subscribe via
//                    `onChange` to keep React state in sync with cross-tab logout.
//   This eliminates the dual-truth bug where api.ts holds a stale module var
//   while session.tsx reads storage directly, and where one tab logout leaves
//   other tabs authenticated until reload.
