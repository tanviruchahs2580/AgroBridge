// Lightweight product analytics: batched beacon POSTs, offline-safe.
// Events buffer in memory and flush every 5s or at 10 events via
// navigator.sendBeacon (fallback: fetch keepalive). Silently no-ops offline.
import { API_BASE } from "./api.js";

interface EventRecord {
  name: string;
  props?: Record<string, string | number>;
  ts: string;
  userId?: string;
}

const ENDPOINT = `${API_BASE}/analytics/events`;
const FLUSH_INTERVAL_MS = 5_000;
const FLUSH_AT_COUNT = 10;

let buffer: EventRecord[] = [];
let userId: string | undefined;
let timer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (timer !== null) return;
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, FLUSH_INTERVAL_MS);
}

async function send(events: EventRecord[]): Promise<boolean> {
  const payload = JSON.stringify({ events });
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    const blob = new Blob([payload], { type: "application/json" });
    if (navigator.sendBeacon(ENDPOINT, blob)) return true;
  }
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
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
    // Restore to the front, cap at 200 events to bound memory.
    buffer = [...batch, ...buffer].slice(0, 200);
    scheduleFlush();
  }
}

export function identify(id: string): void {
  userId = id;
}

export function track(name: string, props?: Record<string, string | number>): void {
  buffer.push({ name, props, ts: new Date().toISOString(), userId });
  if (buffer.length >= FLUSH_AT_COUNT) void flush();
  else scheduleFlush();
}

// Best-effort flush when the page goes away / app backgrounds.
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && buffer.length > 0 && navigator.onLine !== false) void send(buffer).then((ok) => ok && (buffer = []));
  });
}
