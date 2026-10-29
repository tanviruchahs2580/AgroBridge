// Offline mutation queue: durable (localStorage) generic queue for allow-listed
// sync endpoints. Enqueued while offline, flushed on `online` event + app boot.
// Dedupe by clientUuid AND a djb2 hash of method+url+body — prevents duplicate
// mutations even when the same URL is hit multiple times while offline.
// Session-scoped: every entry records who queued it and when, so a shared
// phone cannot replay one account's writes under the next account's session.
import { api, isOnline, ApiError } from "./api";
import { uuid } from "./uuid";
import { t } from "./i18n";
import type { Lang } from "./i18n";
// One-way dependency by design: the queue needs the signed-in identity, but
// sessionManager must never load the queue — a logout would then pull the
// transport module into its own teardown path.
import { getSession, getTokens, onChange as onSessionChange } from "./sessionManager";
import { isQueueable } from "./offlineQueueRules";

export interface QueuedMutation {
  url: string;
  method: string;
  body?: unknown;
  clientUuid: string;
  payloadHash: string; // djb2 of method+url+body for dedupe (see hashPayload)
  /** Epoch ms the mutation was queued — TTL anchor for the replay window.*/
  queuedAt: number;
  /** userId that queued it; "" when no session was known (legacy entry).*/
  ownerId: string;
}

const KEY = "agrobridge.mutationQueue";

/**
 * Queued work is only worth replaying while the user still remembers making it.
 * Past this age the entry is dropped with a notice instead of sent blind: the
 * farm/stock/price state it was built on has moved on, and applying a days-old
 * write silently is how stale data wins.
 */
const MAX_QUEUE_AGE_MS = 72 * 60 * 60 * 1000;

/**
 * The queueability rule lives in ./offlineQueueRules (no imports — see that
 * file for why it must be dependency-free) and is re-exported here so every
 * existing importer keeps working.
 */
export { isQueueable } from "./offlineQueueRules";

const listeners = new Set<(count: number) => void>();
/** Enqueue toast notifiers — App.tsx registers toast.info when a mutation is queued offline */
const enqueueNotifiers = new Set<() => void>();
/**
 * Drop notifiers — App.tsx registers toast.error when a queued mutation is
 * discarded for good (permanent 4xx / second-strike 401/403). The user is told
 * what was lost instead of the failure living only in console.warn.
 * `outcome` separates a state conflict (409/422 — the user should review it)
 * from a plain permanent failure and from TTL expiry.
 */
export type DropOutcome = "conflict" | "discarded" | "expired";
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
 * one toast covers all of them)..
 */
const syncedNotifiers = new Set<(count: number) => void>();
export function onSync(cb: (count: number) => void): () => void {
  syncedNotifiers.add(cb);
  return () => syncedNotifiers.delete(cb);
}
function notifySynced(count: number) {
  for (const cb of syncedNotifiers) cb(count);
}
/**
 * Storage-error notifiers — App.tsx raises the "could not be saved on this
 * device" toast. `keptInMemory` says whether the queue is still replayable in
 * this tab but no longer survives a reload (localStorage quota / private mode).
 */
export interface QueueStorageError {
  keptInMemory: boolean;
}
const storageErrorNotifiers = new Set<(info: QueueStorageError) => void>();
export function onStorageError(cb: (info: QueueStorageError) => void): () => void {
  storageErrorNotifiers.add(cb);
  return () => storageErrorNotifiers.delete(cb);
}
function notifyStorageError(info: QueueStorageError) {
  for (const cb of storageErrorNotifiers) cb(info);
}
/** True once a persistence attempt failed — the queue then lives in memory only.*/
export function storageDegraded(): boolean {
  return degraded;
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
  ensureSessionWatch();
  if (memoryOnly) return memoryOnly.slice();
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return stampLegacy(parsed as QueuedMutation[]);
  } catch {
    return [];
  }
}

/** Non-persistent copy of the queue, used once localStorage rejects writes.*/
let memoryOnly: QueuedMutation[] | null = null;
let degraded = false;
let sessionWatchBound = false;
/** userId the watcher last saw, so a switch is detectable ("" = signed out).*/
let lastOwnerId = "";

/**
 * Upgrade entries persisted before the queue was session-scoped: stamp the
 * missing `queuedAt`/`ownerId` and persist the upgrade so the next flush can
 * apply the same TTL/ownership rules to them. Queued age cannot be
 * reconstructed, so a legacy entry starts its window now — dropping the user's
 * pending work on upgrade would be the one outcome the stamping must avoid.
 */
function stampLegacy(list: QueuedMutation[]): QueuedMutation[] {
  const current = getSession()?.userId ?? "";
  const now = Date.now();
  let upgraded = false;
  for (const entry of list) {
    const hasAge = typeof entry.queuedAt === "number" && Number.isFinite(entry.queuedAt);
    const hasOwner = typeof entry.ownerId === "string";
    if (hasAge && hasOwner) continue;
    if (!hasAge) entry.queuedAt = now;
    if (!hasOwner) entry.ownerId = current;
    upgraded = true;
  }
  if (upgraded) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
      /* best-effort upgrade — the caller still gets the stamped list*/
    }
  }
  return list;
}

function save(list: QueuedMutation[]) {
  try {
    if (list.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(list));
    // A write that lands retires the fallback: storage is authoritative again.
    memoryOnly = null;
    degraded = false;
  } catch {
    // Quota full / private mode: keep the list so this tab can still replay it,
    // and say so — a silently swallowed failure loses field work at the next
    // reload without ever telling the user.
    memoryOnly = list.slice();
    degraded = true;
    notifyStorageError({ keptInMemory: true });
  }
  emit();
}

/**
 * Drop every queued mutation. A device-scoped queue must not outlive the
 * session it was queued in: on a shared phone (the common case in the markets
 * this app targets) the next person to sign in would otherwise have the
 * previous user's writes replayed under their own account.
 *
 * `notifyUser` decides whether the person still looking at the screen is told
 * what was dropped. It is true when the queue's owner is still the reader (their
 * own logout — the badge was counting those changes seconds earlier, so a silent
 * discard is data loss the user never hears about), and false when someone else
 * is now signed in: telling the new user what the previous one had pending would
 * leak it, so that path keeps the console warning only.
 */
export function purgeQueue(reason: string, notifyUser: boolean = true): void {
  const dropped = load();
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* storage blocked — the in-memory copy below is still cleared*/
  }
  memoryOnly = null;
  attempts.clear();
  if (dropped.length > 0) console.warn(`[offlineQueue] discarded ${dropped.length} queued mutation(s): ${reason}`);
  if (notifyUser) for (const entry of dropped) notifyDrop(entry, 0, "discarded");
  emit();
}

/**
 * Purge on identity change or logout. Subscribed once, lazily on first queue
 * use, so a session that never queues anything pays nothing.
 *
 * Two deliberate non-purges:
 * - "unknown owner → user" ("" to a userId): entries stamped with no owner
 * precede the session and are cleared by the flush guard, not destroyed the
 * moment a session hydrates.
 * - session dropped with tokens still present: session.tsx does that when the
 * boot request fails offline, keeping the tokens so the user is not logged
 * out. Purging there would delete queued field work in exactly the situation
 * the queue exists for. A real logout/expiry clears the tokens first, so that
 * is the signal — and the identity is remembered until a token-less null or a
 * different user resolves it.
 */
function ensureSessionWatch(): void {
  if (sessionWatchBound) return;
  sessionWatchBound = true;
  lastOwnerId = getSession()?.userId ?? "";
  onSessionChange(({ session }) => {
    const nextId = session?.userId ?? "";
    if (nextId === "") {
      if (getTokens().accessToken) return; // unconfirmed session, still this user's tokens
      if (lastOwnerId === "") return;
      lastOwnerId = "";
      purgeQueue("session ended");
      return;
    }
    if (lastOwnerId !== "" && lastOwnerId !== nextId) purgeQueue("a different user signed in", false);
    lastOwnerId = nextId;
  });
}

function emit() {
  const n = size();
  for (const cb of listeners) cb(n);
}

/** Queue a mutation for later replay. Non-allow-listed methods/URLs are ignored silently.
 * Dedupes by clientUuid first (primary), then by hash (secondary for auto-generated).
 * When an explicit clientUuid is given, only that UUID is checked — preventing
 * false-positive dedup that would block identical payloads with different UUIDs.
 * Stamps the queueing time and the signed-in owner, which is what later lets the
 * flush refuse work that is not this user's or is too old to be safe to replay.*/
export function enqueue(m: Omit<QueuedMutation, "clientUuid" | "payloadHash" | "queuedAt" | "ownerId"> & { clientUuid?: string }): string | null {
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

  const entry: QueuedMutation = {
    method: m.method.toUpperCase(),
    url: m.url,
    body: m.body,
    clientUuid,
    payloadHash: hash,
    queuedAt: Date.now(),
    ownerId: getSession()?.userId ?? "",
  };
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
 * Entries are screened before any request leaves the device: one queued by a
 * different account is dropped (its owner is long gone from this session) and
 * one older than the replay window is dropped as expired. Both are reported
 * through `onDrop` like any other refusal, so the change never disappears
 * silently.
 * - success → removed
 * - network/5xx → kept for next flush
 * - 401/403 → re-queued once, dropped on the second strike
 * - other permanent 4xx → dropped (will never succeed)
 * Drops keep their console.warn for diagnostics and also notify `onDrop`
 * subscribers, which is how the user-visible bilingual toast is raised.
 * A flush that saved N>0 mutations notifies `onSync` exactly once with N.
 * Never throws.
 *
 * Re-entrancy: boot calls flushAll directly AND the online subscription's
 * registration callback fires a second one synchronously (see lib/api.ts
 * onOnlineStatusChange) — without a mutex both loaded the same persisted
 * list before either saved, double-sending every mutation and firing the
 * "saved" toast twice. Concurrent callers now share one in-flight flush.
 */
let flushing: Promise<void> | null = null;

export function flushAll(): Promise<void> {
  if (flushing) return flushing;
  flushing = doFlush().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function doFlush(): Promise<void> {
  if (!isOnline()) return;
  const list = load();
  if (list.length === 0) return;

  const currentOwner = getSession()?.userId ?? "";
  const now = Date.now();
  const replay: QueuedMutation[] = [];
  for (const entry of list) {
    if (entry.ownerId && entry.ownerId !== currentOwner) {
      // Backstop for what purge-on-switch already prevents: a queue written by
      // another account must never be replayed as this one. status 0 = refused
      // by the queue itself, not by the server.
      console.warn(`[offlineQueue] dropping mutation ${entry.clientUuid} — queued by another account`, entry.url);
      notifyDrop(entry, 0, "discarded");
      continue;
    }
    if (now - entry.queuedAt > MAX_QUEUE_AGE_MS) {
      console.warn(`[offlineQueue] dropping mutation ${entry.clientUuid} — older than the replay window`, entry.url);
      notifyDrop(entry, 0, "expired");
      continue;
    }
    replay.push(entry);
  }

  let synced = 0;
  const remaining: QueuedMutation[] = [];
  for (const entry of replay) {
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
  // One "synced" signal per flush, carrying how many mutations landed.
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
 * read as "needs your review", a TTL drop as "too old to send any more", every
 * other permanent failure as "discarded".
 */
export function dropToastMessage(entry: QueuedMutation, outcome: DropOutcome, lang: Lang): string {
  const item = queueItemLabel(entry.url, lang);
  if (outcome === "conflict") return t("queuedChangeConflict", lang, { item });
  if (outcome === "expired") return t("queuedChangeExpired", lang, { item });
  return t("queuedChangeDropped", lang, { item });
}

/** Toast copy for a successful flush of N>0 queued mutations ("queued changes saved"). */
export function syncToastMessage(count: number, lang: Lang): string {
  return count === 1
    ? t("queueSyncedToastOne", lang, { n: count })
    : t("queueSyncedToastMany", lang, { n: count });
}
