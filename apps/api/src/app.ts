import express from "express";
import cors from "cors";
// These packages ship ES default exports; some serverless builders recompile
// the program without esModuleInterop, so bind through the namespace default.
import * as helmetModule from "helmet";
import * as rateLimitModule from "express-rate-limit";
const helmet = helmetModule.default;
const rateLimit = rateLimitModule.default;
import { corsAllowedOrigins, env, isDev, isProd } from "./config/env.js";
import { requestContext } from "./middleware/context.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { prisma } from "./lib/prisma.js";
import { logger } from "./lib/logger.js";
import { registry, metricsMiddleware, dbUp } from "./lib/metrics.js";
import { createRedisStore } from "./lib/rateLimitRedis.js";
import { readSchemaState } from "./infrastructure/schemaState.js";
import { storageReadiness } from "./providers/storage/index.js";

// Multi-instance deployments set REDIS_URL so all pods share limit windows.
const sharedStore = env.REDIS_URL ? createRedisStore(env.REDIS_URL) : undefined;
if (sharedStore) logger.info("rate limiting backed by Redis");
/**
 * Which store the limiters actually use. Reported by `/ready` because it is a
 * real operational property, not trivia: without Redis every serverless
 * instance enforces its own windows, so the effective quota is
 * (instances × configured max) — an accepted fail-open (docs/security.md) that
 * must at least be visible to whoever reads production state.
 */
const limiterStore: "redis" | "memory" = sharedStore ? "redis" : "memory";
if (!sharedStore && isProd) {
  logger.warn("REDIS_URL is unset in production: rate-limit windows are per instance (documented fail-open)");
}

import { authRouter } from "./modules/auth/routes.js";
import { farmsRouter } from "./modules/farms/routes.js";
import { weatherRouter } from "./modules/weather/routes.js";
import { aiRouter } from "./modules/aiagent/routes.js";
import { diseaseRouter } from "./modules/disease/routes.js";
import { productsRouter, cartRouter, ordersRouter } from "./modules/marketplace/routes.js";
import { servicesRouter, bookingsRouter } from "./modules/services/routes.js";
import { procurementRouter } from "./modules/procurement/routes.js";
import { paymentsRouter, walletRouter, membershipRouter } from "./modules/payments/routes.js";
import { notificationsRouter } from "./modules/notifications/routes.js";
import { adminRouter } from "./modules/admin/routes.js";
import { organizationsRouter } from "./modules/organizations/routes.js";
import { analyticsRouter } from "./modules/analytics/routes.js";
import { paymentWebhookRouter } from "./modules/payments/webhook.js";
import { metricsGuard } from "./middleware/metricsGuard.js";
import { rateLimitHandler } from "./middleware/rateLimitResponse.js";
import { credentialOrIpKey } from "./middleware/rateLimitKeys.js";
import { admissionControl } from "./middleware/admission.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", env.TRUST_PROXY === "false" ? false : env.TRUST_PROXY);
  app.disable("x-powered-by");

  app.use(helmet({ contentSecurityPolicy: isProd ? undefined : false }));
  app.use(
    cors({
      origin: corsAllowedOrigins,
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE"],
      // Custom response headers the web client reads: the correlation ids
      // (request id + W3C trace context) and the list totals that make
      // truncation visible. Without this, cross-origin callers see neither.
      exposedHeaders: ["X-Request-Id", "traceparent", "X-Total-Count"],
    })
  );
  // Global body limits; JSON only for non-multipart routes.
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false, limit: "200kb" }));

  app.use(requestContext);
  app.use(metricsMiddleware);

  const globalLimiter = rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    limit: env.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    // Keyed per credential when one is presented, per address otherwise (F-04):
    // an IP-keyed global quota is a quota shared with every stranger behind the
    // same carrier NAT, which is how a village loses its marketplace to the
    // first few users of the window. See middleware/rateLimitKeys.ts.
    keyGenerator: credentialOrIpKey,
    // Relaxed in local dev; enforced in test/staging/production.
    skip: () => isDev,
    store: sharedStore,
    message: { ok: false, error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down." } },
    handler: rateLimitHandler,
  });
  // Capacity guard before the quota guard (F-05): a shed request must cost no
  // rate-limit budget, and `/api/`-only mounting keeps /health, /ready and
  // /metrics answerable while the instance is at its ceiling.
  app.use("/api/", admissionControl);
  app.use("/api/", globalLimiter);

  // ---- Observability endpoints ----
  /**
   * Liveness. Also reports the deployed commit so a deployment can be verified
   * against a specific SHA without opening the dashboard: Vercel injects
   * VERCEL_GIT_COMMIT_SHA for both Git-integration and CLI deployments. `null`
   * means the runtime did not tell us — never a guess.
   */
  const deployedCommit = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT ?? "").slice(0, 7) || null;
  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "agrobridge-api",
      time: new Date().toISOString(),
      commit: deployedCommit,
      env: env.NODE_ENV,
    });
  });

  app.get("/ready", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbUp.set(1);
      // Schema state is part of the answer to "can this release serve?" — the
      // deploy gate compares `schema.latest` with the repository's newest
      // migration (ADR-0007).
      const schema = await readSchemaState();
      // Storage durability is release-blocking, like the schema: production
      // must outlive its instances (deploy-verify.yml enforces it).
      res.json({ ok: true, ready: true, db: true, schema, limiterStore, storage: storageReadiness() });
    } catch {
      dbUp.set(0);
      res.status(503).json({ ok: false, ready: false, db: false });
    }
  });

  app.get("/metrics", metricsGuard, async (_req, res) => {
    res.setHeader("Content-Type", registry.contentType);
    res.send(await registry.metrics());
  });

  // ---- Versioned API ----
  const v1 = express.Router();
  // Payment gateway IPN/webhooks are unauthenticated by design and verify
  // provider signatures themselves; mounted BEFORE the auth-gated router.
  v1.use("/payments", paymentWebhookRouter);
  v1.use("/auth", authRouter);
  v1.use("/farms", farmsRouter);
  v1.use("/weather", weatherRouter);
  v1.use("/ai", aiRouter);
  v1.use("/disease", diseaseRouter);
  v1.use("/products", productsRouter);
  v1.use("/cart", cartRouter);
  v1.use("/orders", ordersRouter);
  v1.use("/services", servicesRouter);
  v1.use("/bookings", bookingsRouter);
  v1.use("/procurement", procurementRouter);
  v1.use("/payments", paymentsRouter);
  v1.use("/wallet", walletRouter);
  v1.use("/membership", membershipRouter);
  v1.use("/notifications", notificationsRouter);
  v1.use("/admin", adminRouter);
  v1.use("/organizations", organizationsRouter);
  v1.use("/analytics", analyticsRouter);
  app.use("/api/v1", v1);

  logger.info("AgroBridge API routes mounted");

  app.get("/", (_req, res) => {
    res.json({ ok: true, service: "agrobridge-api", message: "AgroBridge API is running", docs: "/health", commit: deployedCommit });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}