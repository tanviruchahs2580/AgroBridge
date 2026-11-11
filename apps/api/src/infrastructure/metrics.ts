import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";
import type { Request, Response, NextFunction } from "express";
import { getHealthRegistry, type HealthStatus } from "../providers/health.js";

export const registry = new Registry();

export const httpRequestsTotal = new Counter({
  name: "agrobridge_http_requests_total",
  help: "Total HTTP requests",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: "agrobridge_http_request_duration_seconds",
  help: "HTTP request duration",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

export const dbUp = new Gauge({
  name: "agrobridge_db_up",
  help: "Database up (1) or down (0)",
  registers: [registry],
});

export const aiRequestsTotal = new Counter({
  name: "agrobridge_ai_requests_total",
  help: "AI advisory requests",
  labelNames: ["provider", "status"] as const,
  registers: [registry],
});

export const paymentIntentsTotal = new Counter({
  name: "agrobridge_payment_intents_total",
  help: "Payment intents created",
  labelNames: ["purpose_type", "status"] as const,
  registers: [registry],
});

/**
 * Requests refused by the admission guard (middleware/admission.ts). F-71: the
 * guard shed requests with a log line only, so a device at its concurrency
 * ceiling produced 503s that appeared solely as `route="unmatched"` in the
 * generic counter — nothing to alert on and no way to see that the capacity
 * guard (rather than a bug) refused the traffic.
 */
export const requestsShedTotal = new Counter({
  name: "agobridge_requests_shed_total",
  help: "Requests refused by admission control because the instance was at its concurrency ceiling",
  registers: [registry],
});

/**
 * Provider health, read at scrape time from the registry the AI gateway writes
 * (`providers/health.ts`). F-28: `markDown("ai", …)` recorded provider failure
 * into a module-level object that no route, metric or log read, so the registry
 * was write-only. The AI/SMS/storage/payment states are readiness facts, and
 * this gauge makes the registry observable without exposing provider
 * configuration on the public readiness endpoint.
 *
 * Value mapping is deliberate: HEALTHY=1, DEGRADED=0.5, DOWN=0, DISABLED=1
 * (an intentionally disabled provider is not a failure). A provider missing
 * from the registry is not reported at all, so "never initialised" is visible
 * as an absent series rather than as a fabricated HEALTHY.
 */
const HEALTH_VALUES: Record<HealthStatus, number> = { HEALTHY: 1, DEGRADED: 0.5, DOWN: 0, DISABLED: 1 };
/** Exported for tests (assert the mapping and the reset-on-scrape behaviour). */
export const providerHealthGauge = new Gauge({
  name: "agobridge_provider_health",
  help: "Provider health from the runtime registry (HEALTHY=1, DEGRADED=0.5, DOWN=0, DISABLED=1)",
  labelNames: ["provider", "status"] as const,
  registers: [registry],
  collect() {
    // Rebuilt from the registry on every scrape; `reset()` drops a series whose
    // provider changed status, so "DOWN" cannot linger after a recovery.
    this.reset();
    for (const entry of Object.values(getHealthRegistry())) {
      this.set({ provider: entry.provider, status: entry.status }, HEALTH_VALUES[entry.status] ?? 0);
    }
  },
});

// Default metrics (CPU, memory) – lightweight
collectDefaultMetrics({ register: registry, prefix: "agobridge_" });

/**
 * Static mount prefixes of the running app, used to attribute a request whose
 * response was written before any route layer dispatched (F-26).
 *
 * Why a table instead of reading `req.baseUrl` at write time: Express restores
 * `req.baseUrl` when a router stack exits, and an auth/permission/limiter
 * refusal is *written by* the app-level error handler — after every router has
 * unwound. Measured against express 4.22.3: inside the refusing middleware
 * `req.baseUrl` is `/api/v1/products`; in the error handler and at `finish` it
 * is `""`. So the fallback has to come from the app's own shape, captured once,
 * rather than from the request.
 *
 * The table is bounded by the number of mounts (tens), so it cannot grow the
 * registry the way a raw-URL label could.
 */
let mountPrefixes: string[] = [];

/**
 * The literal mount path of an Express layer, read from its matcher.
 *
 * `layer.path` is not populated for a mounted router (express 4.22.3 keeps it
 * undefined and compiles the path into `layer.regexp`), so the source of that
 * regexp is decoded instead: `/api/v1/` becomes `/api/v1` from
 * `^\/api\/v1\/?(?=\/|$)`. Parameterised layers (`/:id`) are skipped — they are
 * not static mounts and guessing at them would mint labels per id.
 */
function layerMountPath(layer: { regexp?: { fast_slash?: boolean; source?: string } }): string | null {
  const re = layer.regexp;
  if (!re || re.fast_slash || typeof re.source !== "string") return null;
  // Express compiles a mount path in two shapes —
  //   routers:   `^\/api\/v1\/?(?=\/|$)`   (trailing lookahead for nesting)
  //   routes:    `^\/health\/?$`           (anchor only)
  // — so both suffixes are stripped before the slashes are unescaped.
  const trimmed = re.source
    .replace(/^\^/, "")
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, "")
    .replace(/\\\/\?\$$/, "")
    .replace(/\$$/, "");
  const decoded = trimmed.replace(/\\\//g, "/");
  // Only a plain static prefix survives the shape check; a `:param`, a regexp
  // group or a character class is skipped rather than guessed at.
  if (!/^\/[A-Za-z0-9_./-]+$/.test(decoded) || decoded.includes(":")) return null;
  return decoded;
}

/**
 * Records the app's mount paths. Called by `createApp` after mounting.
 *
 * The labels recorded are the ROUTER mounts (`/api/v1/products`,
 * `/api/v1/admin`) plus any route registered directly on the app (`/health`,
 * `/ready`, `/metrics`) — not every leaf route. That is the granularity the
 * fallback needs: an early refusal knows which router it was in, and one series
 * per module is what an operator can alert on. Recursing into a router's stack
 * replaces the parent's label with each child's, so `/api/v1` itself disappears
 * when its children are named (its handlers are only the rate limiter and the
 * admission guard, whose prefix the mount table would otherwise mask).
 */
export function registerMountPrefixes(app: { _router?: { stack?: unknown[] } }): void {
  const found = new Set<string>();
  const walk = (stack: unknown[], prefix: string): void => {
    for (const raw of stack) {
      const layer = raw as {
        name?: string;
        handle?: { stack?: unknown[] };
        regexp?: { fast_slash?: boolean; source?: string };
      };
      const path = layerMountPath(layer);
      if (layer.name === "router" && layer.handle?.stack) {
        walk(layer.handle.stack, path ? `${prefix}${path}` : prefix);
        if (path) found.add(`${prefix}${path}`);
        continue;
      }
      if (path) found.add(`${prefix}${path}`);
    }
  };
  walk(app._router?.stack ?? [], "");
  mountPrefixes = [...found].sort((a, b) => b.length - a.length); // longest first
}

/** The mount prefix a path belongs to, or null when nothing matches. */
export function mountedPrefixFor(pathname: string): string | null {
  for (const prefix of mountPrefixes) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return prefix;
  }
  return null;
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  // `req.path` at finish time may be the unwound router's relative url (both
  // are restored on the way out); the request line's own pathname is captured
  // here, before any router touches it.
  const originalPath = (req.originalUrl ?? req.url ?? "").split("?")[0] ?? "";
  res.on("finish", () => {
    // The route label must come from the matched route PATTERN, never the raw
    // URL: unmatched requests (404s, scanner traffic — they bypass the /api
    // rate limiter) previously minted one label per attacker-chosen path,
    // growing the registry without bound.
    //
    // `req.route` is set only once a route LAYER dispatches, so a refusal from
    // an earlier middleware — `requireAuth` 401, `requirePermission` 403, the
    // rate limiter's 429, admission control's 503 — has no route pattern. It
    // falls back to the request's mount prefix, which is what makes 401/403/429
    // on real endpoints attributable at all (F-26: every one of them was
    // counted as `unmatched`). Paths under no known mount stay `unmatched`.
    const routePath = (req.route as { path?: unknown } | undefined)?.path;
    const mounted = mountedPrefixFor(originalPath);
    const route =
      typeof routePath === "string" && routePath
        ? `${req.baseUrl}${routePath}`
        : mounted ?? "unmatched";
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    httpRequestDuration.observe(labels, duration);
  });
  next();
}
