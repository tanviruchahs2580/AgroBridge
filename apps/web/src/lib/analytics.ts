// Lightweight first-party product analytics: batched, authenticated POSTs.
// Events buffer in memory and flush every 5s, at 10 events, or when the app
// backgrounds. The API requires a bearer token and derives the user from it,
// so the payload carries only what the endpoint accepts (name + props) —
// never a client-supplied identity or `ts` the server would ignore anyway.
import { API_BASE, refreshAccessToken } from "./api";
import { getTokens } from "./sessionManager";

interface EventRecord {
  name: string;
  props?: Record<string, string | number>;
}

const ENDPOINT = `${API_BASE}/analytics/events`;
const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_AT_COUNT = 10;
const MAX_BUFFERED = 200;

let buffer: EventRecord[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

/**
 * `keepalive` keeps the request alive while the page is being hidden, which is
 * what sendBeacon used to provide — but sendBeacon cannot attach an
 * Authorization header, and without one every batch was rejected with 401 and
 * silently discarded (the admin analytics screen showed an empty dataset).
 */
async function post(events: EventRecord[]): Promise<Response | null> {
  const token = getTokens().accessToken;
  if (!token) return null; // nothing to attribute the events to; drop the batch
  try {
    return await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ events }),
      keepalive: true,
    });
  } catch {
    return null; // offline / blocked: keep the batch buffered
  }
}

async function send(events: EventRecord[]): Promise<boolean> {
  if (!getTokens().accessToken) return true; // drop: the endpoint requires auth
  let res = await post(events);
  if (res && res.status === 401) {
    if (await refreshAccessToken()) res = await post(events);
  }
  return res ? res.ok : false;
}

/** Fire-and-forget; resolves when the batch left the buffer (sent or restored after failure). */
async function flush(): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (buffer.length === 0) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return; // stay buffered

  const batch = buffer;
  buffer = [];
  const sent = await send(batch);
  if (!sent) {
    // Restore to the front, capped to bound memory.
    buffer = [...batch, ...buffer].slice(0, MAX_BUFFERED);
    scheduleFlush();
  }
}

export function track(name: string, props?: Record<string, string | number>): void {
  buffer.push(props ? { name, props } : { name });
  /**
   * Cap on push, not only on the failed-send restore. While the device is offline
   * `flush` returns early without touching the buffer, so the only bound was the
   * one applied on the restore path — an offline session accumulated events
   * unbounded, in memory, for the whole outage. Drop the oldest beyond the cap:
   * analytics are diagnostic, and losing the oldest telemetry is the right trade
   * against growth on the devices this app runs on.
   */
  if (buffer.length > MAX_BUFFERED) buffer = buffer.slice(-MAX_BUFFERED);
  if (buffer.length >= FLUSH_AT_COUNT) void flush();
  else scheduleFlush();
}

// Best-effort flush when the app goes to the background / the tab is hidden.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
}
