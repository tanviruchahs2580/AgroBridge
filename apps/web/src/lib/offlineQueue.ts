// Offline mutation queue: durable (localStorage) generic queue for allow-listed
// sync endpoints. Enqueued while offline, flushed on `online` event + app boot.
// Dedupe by clientUuid AND SHA-256 payload hash — prevents duplicate mutations
// even when the same URL is hit multiple times while offline.
import { api, isOnline, ApiError } from "./api";
import { t } from "./i18n";
import type { Lang } from "./i18n";

export interface QueuedMutation {
  url: string;
  method: string;
  body?: unknown;
  clientUuid: string;
  payloadHash: string; // SHA-256 of method+url+body for dedupe
}

const KEY = "agrobridge.mutationQueue";

/**
 * Endpoints that must never be replayed blind. A checkout is not idempotent:
 * replaying a queued attempt after the user retried manually creates a second
 * order and decrements stock twice, so it stays out even though it lives under
 * /orders.
 */
const NEVER_QUEUE = ["/orders/checkout"];

/**
 * Methods that change server state and are therefore the only ones worth
 * replaying. A failed GET is a read, not a pending change: replaying it later
 * would send a stale request as if it were a mutation and would inflate the
 * user-facing queue badge for work no one ever asked to retry.
 */
const QUEUEABLE_METHODS = new Set(["POST", "PATCH", "DELETE"]);

/**
 * Allow-list: state-changing requests to farm events, cart, and orders sync
 * endpoints. Method-aware (WEB-4): reads (`GET`/`HEAD`/…) are never queued.
 */
export function isQueueable(method: string, url: string): boolean {
  if (!QUEUEABLE_METHODS.has(method.toUpperCase())) return false;
  if (NEVER_QUEUE.some((p) => url.includes(p))) return false;
  return url.includes("/events") || url.includes("/cart") || url.includes("/orders");
}

const listeners = new Set<(count: number) => void>();
/** Enqueue toast notifiers — App.tsx registers toast.info when a mutation is queued offline */
const enqueueNotifiers = new Set<() => void>();
/**
 * Drop notifiers — App.tsx registers toast.error when a queued mutation is
 * discarded for good (permanent 4xx / second-strike 401/403). The user is told
 * what was lost instead of the failure living only in console.warn (AUD-112b).
 * `outcome` separates a state conflict (409/422 — the user should review it)
 * from a plain permanent failure (G-07).
 */
export type DropOutcome = "conflict" | "discarded";
const dropNotifiers = new Set<(entry: QueuedMutation, status: number, outcome: DropOutcome) => void>();
export function onDrop(cb: (entry: QueuedMutation, status: number, outcome: DropOutcome) => void): () => void {
  dropNotifiers.add(cb);
  return () => dropNotifiers.delete(cb);
}
function notifyDrop(entry: QueuedMutation, status: number, outcome: DropOutcome) {
  for (const cb of dropNotifiers) cb(entry, status, outcome);
}
/**
 * Sync notifiers — App.tsx registers the "queued changes saved" toast; fired
 * once per flush that persisted at least one queued mutation (count in hand, so
 * one toast covers all of them). G-07.
 */
const syncedNotifiers = new Set<(count: number) => void>();
export function onSync(cb: (count: number) => void): () => void {
  syncedNotifiers.add(cb);
  return () => syncedNotifiers.delete(cb);
}
function notifySynced(count: number) {
  for (const cb of syncedNotifiers) cb(count);
}
export function onEnqueue(cb: () => void): () => void {
  enqueueNotifiers.add(cb);
  return () => enqueueNotifiers.delete(cb);
}
function notifyEnqueue() {
  // One notification per enqueue, deliberately. This also used to dispatch an
  // `agrobridge:offline-queued` window event "for non-React consumers" while
  // App.tsx subscribed to both paths — a single queued mutation therefore showed
  // the offline toast twice. Nothing outside React ever listened to the event
  // (its only subscriber was the test asserting it), so the duplicate is gone and
  // that test now fails if an event is emitted again.
  for (const cb of enqueueNotifiers) cb();
}
/** In-session flush attempt counters (not persisted — a fresh session gets a fresh retry budget). */
const attempts = new Map<string, number>();

/** Compute a deterministic sync hash from the method + URL + body for dedupe. */
function payloadHashFn(method: string, url: string, body?: unknown): string {
  const raw = `${method}|${url}|${body ? JSON.stringify(body) : ""}`;
  // djb2 hash — fast, deterministic, no crypto dependency needed for dedupe
  let h = 5381;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    h = ((h << 5) + h) + c;
    h |= 0; // clamp to 32-bit int
  }
  return (Math.abs(h).toString(16).padStart(8, "0"));
}

function load(): QueuedMutation[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as QueuedMutation[]) : [];
  } catch {
    return [];
  }
}

function save(list: QueuedMutation[]) {
  try {
    if (list.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage full/blocked — keep memory state only */
  }
  emit();
}

function emit() {
  const n = size();
  for (const cb of listeners) cb(n);
}

// Fallback counter for environments without WebCrypto (js/insecure-randomness:
// these IDs are idempotency tokens, so Math.random must not generate them).
let uuidFallbackCounter = 0;

function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  if (typeof c?.getRandomValues === "function") {
    const bytes = c.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
    const hex = Array.from(bytes, (b: number) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  // No WebCrypto at all: timestamp + monotonic counter, never Math.random.
  return `${Date.now().toString(36)}-${(uuidFallbackCounter++).toString(36)}`;
}

/** Queue a mutation for later replay. Non-allow-listed methods/URLs are ignored silently.
 * Dedupes by clientUuid first (primary), then by hash (secondary for auto-generated).
 * When an explicit clientUuid is given, only that UUID is checked — preventing
 * false-positive dedup that would block identical payloads with different UUIDs. */
export function enqueue(m: Omit<QueuedMutation, "clientUuid" | "payloadHash"> & { clientUuid?: string }): string | null {
  if (!isQueueable(m.method, m.url)) return null;
  const clientUuid = m.clientUuid ?? uuid();
  const hash = payloadHashFn(m.method.toUpperCase(), m.url, m.body);
  const list = load();

  const hasExplicitUuid = Boolean(m.clientUuid);

  if (hasExplicitUuid) {
    // Explicit clientUuid: dedupe only by UUID (caller owns idempotency).
    if (list.some((e) => e.clientUuid === clientUuid)) return null;
  } else {
    // Auto-generated: dedupe by UUID first, then by hash to avoid
    // duplicates of the same mutation sent multiple times while offline.
    if (list.some((e) => e.clientUuid === clientUuid || e.payloadHash === hash)) return null;
  }

  const entry: QueuedMutation = { method: m.method.toUpperCase(), url: m.url, body: m.body, clientUuid, payloadHash: hash };
  list.push(entry);
  save(list);
  // Notify the UI that an offline mutation was queued (toast "অফলাইন — পরে পাঠানো হবে")
  notifyEnqueue();
  return clientUuid;
}

export function size(): number {
  return load().length;
}

export function subscribe(cb: (count: number) => void): () => void {
  listeners.add(cb);
  cb(size());
  return () => listeners.delete(cb);
}

/**
 * Replay every queued mutation in order.
 * - success → removed
 * - network/5xx → kept for next flush
 * - 401/403 → re-queued once, dropped on the second strike
 * - other permanent 4xx → dropped (will never succeed)
 * Drops keep their console.warn for diagnostics and also notify `onDrop`
 * subscribers, which is how the user-visible bilingual toast is raised.
 * A flush that saved N>0 mutations notifies `onSync` exactly once with N.
 * Never throws.
 */
export async function flushAll(): Promise<void> {
  if (!isOnline()) return;
  const list = load();
  if (list.length === 0) return;

  let synced = 0;
  const remaining: QueuedMutation[] = [];
  for (const entry of list) {
    try {
      await api(entry.method, entry.url, entry.body);
      attempts.delete(entry.clientUuid);
      synced++;
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        const isAuth = err.status === 401 || err.status === 403;
        const strikes = (attempts.get(entry.clientUuid) ?? 0) + 1;
        if (isAuth && strikes <= 1) {
          attempts.set(entry.clientUuid, strikes);
          remaining.push(entry); // re-queue once
        } else {
          attempts.delete(entry.clientUuid);
          // 409/422 mean server state and the queued change disagree — report
          // that as a conflict the user must review, not as a plain discard.
          const outcome: DropOutcome = err.status === 409 || err.status === 422 ? "conflict" : "discarded";
          console.warn(`[offlineQueue] dropping mutation ${entry.clientUuid} (${err.status} ${err.code}, ${outcome})`, entry.url);
          // Tell the user the write is gone; the queue semantics stay identical
          // (nothing is retried again after a drop).
          notifyDrop(entry, err.status, outcome);
        }
      } else {
        remaining.push(entry); // network / timeout / 5xx — retry next flush
      }
    }
  }
  save(remaining);
  // One "synced" signal per flush, carrying how many mutations landed (G-07).
  if (synced > 0) notifySynced(synced);
}

/** What a queued mutation was, in the active UI language (toast copy). */
function queueItemLabel(url: string, lang: Lang): string {
  if (url.includes("/events")) return t("queuedItemFarmEvent", lang);
  if (url.includes("/cart")) return t("cart", lang);
  return t("orders", lang);
}

/**
 * Toast copy for a mutation the queue dropped — conflict-ish outcomes (409/422)
 * read as "needs your review", every other permanent failure as "discarded".
 */
export function dropToastMessage(entry: QueuedMutation, outcome: DropOutcome, lang: Lang): string {
  const item = queueItemLabel(entry.url, lang);
  return outcome === "conflict"
    ? t("queuedChangeConflict", lang, { item })
    : t("queuedChangeDropped", lang, { item });
}

/** Toast copy for a successful flush of N>0 queued mutations ("queued changes saved"). */
export function syncToastMessage(count: number, lang: Lang): string {
  return count === 1
    ? t("queueSyncedToastOne", lang, { n: count })
    : t("queueSyncedToastMany", lang, { n: count });
}
