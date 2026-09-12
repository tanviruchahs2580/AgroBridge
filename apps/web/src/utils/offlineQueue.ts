// Offline mutation queue: durable (localStorage) generic queue for allow-listed
// sync endpoints. Enqueued while offline, flushed on `online` event + app boot.
// Dedupe by clientUuid AND SHA-256 payload hash — prevents duplicate mutations
// even when the same URL is hit multiple times while offline.
import { api, isOnline, ApiError } from "../api/client";

export interface QueuedMutation {
  url: string;
  method: string;
  body?: unknown;
  clientUuid: string;
  payloadHash: string; // SHA-256 of method+url+body for dedupe
}

const KEY = "agrobridge.mutationQueue";

/** Allow-list: farm events, cart, and orders sync endpoints. */
export function isQueueable(url: string): boolean {
  return url.includes("/events") || url.includes("/cart") || url.includes("/orders");
}

const listeners = new Set<(count: number) => void>();
/** STEP 55: enqueue toast notifiers — App.tsx registers toast.info when a mutation is queued offline */
const enqueueNotifiers = new Set<() => void>();
export function onEnqueue(cb: () => void): () => void {
  enqueueNotifiers.add(cb);
  return () => enqueueNotifiers.delete(cb);
}
function notifyEnqueue() {
  for (const cb of enqueueNotifiers) cb();
  // also dispatch window event for non-React consumers
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("agrobridge:offline-queued"));
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

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Queue a mutation for later replay. Non-allow-listed URLs are ignored silently.
 * Dedupes by clientUuid first (primary), then by hash (secondary for auto-generated).
 * When an explicit clientUuid is given, only that UUID is checked — preventing
 * false-positive dedup that would block identical payloads with different UUIDs. */
export function enqueue(m: Omit<QueuedMutation, "clientUuid" | "payloadHash"> & { clientUuid?: string }): string | null {
  if (!isQueueable(m.url)) return null;
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
  // STEP 55: notify UI that an offline mutation was queued (toast "অফলাইন — পরে পাঠানো হবে")
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
 * - 401/403 → re-queued once, dropped with console.warn on the second strike
 * - other permanent 4xx → dropped with console.warn (will never succeed)
 * Never throws.
 */
export async function flushAll(): Promise<void> {
  if (!isOnline()) return;
  const list = load();
  if (list.length === 0) return;

  const remaining: QueuedMutation[] = [];
  for (const entry of list) {
    try {
      await api(entry.method, entry.url, entry.body);
      attempts.delete(entry.clientUuid);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        const isAuth = err.status === 401 || err.status === 403;
        const strikes = (attempts.get(entry.clientUuid) ?? 0) + 1;
        if (isAuth && strikes <= 1) {
          attempts.set(entry.clientUuid, strikes);
          remaining.push(entry); // re-queue once
        } else {
          attempts.delete(entry.clientUuid);
          console.warn(`[offlineQueue] dropping mutation ${entry.clientUuid} (${err.status} ${err.code})`, entry.url);
        }
      } else {
        remaining.push(entry); // network / timeout / 5xx — retry next flush
      }
    }
  }
  save(remaining);
}
