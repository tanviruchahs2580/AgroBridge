import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { env, isProd } from "./config/env.js";
import { requestContext } from "./middleware/context.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { prisma } from "./lib/prisma.js";
import { logger } from "./lib/logger.js";
import { registry, metricsMiddleware, dbUp } from "./lib/metrics.js";

import { authRouter } from "./modules/auth/routes.js";
import { farmsRouter } from "./modules/farms/routes.js";
import { weatherRouter } from "./modules/weather/routes.js";
import { aiRouter } from "./modules/aiagent/routes.js";
import { diseaseRouter } from "./modules/aiagent/disease.js";
import { productsRouter, cartRouter, ordersRouter } from "./modules/marketplace/routes.js";
import { servicesRouter, bookingsRouter } from "./modules/services/routes.js";
import { procurementRouter } from "./modules/procurement/routes.js";
import { paymentsRouter, walletRouter, membershipRouter } from "./modules/payments/routes.js";
import { notificationsRouter } from "./modules/notifications/routes.js";
import { adminRouter } from "./modules/admin/routes.js";
import { organizationsRouter } from "./modules/organizations/routes.js";

export function createApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.disable("x-powered-by");

  app.use(helmet({ contentSecurityPolicy: isProd ? undefined : false }));
  app.use(
    cors({
      origin: env.WEB_ORIGIN.split(",").map((s) => s.trim()),
      credentials: true,
      methods: ["GET", "POST", "PATCH", "DELETE"],
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
    // Relaxed in local dev; enforced in test/staging/production.
    skip: () => process.env.NODE_ENV === "development",
    message: { ok: false, error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down." } },
  });
  app.use("/api/", globalLimiter);

  // ---- Observability endpoints (Section 35) ----
  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "agrobridge-api", time: new Date().toISOString() });
  });

  app.get("/ready", async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbUp.set(1);
      res.json({ ok: true, ready: true, db: true });
    } catch {
      dbUp.set(0);
      res.status(503).json({ ok: false, ready: false, db: false });
    }
  });

  app.get("/metrics", async (_req, res) => {
    res.setHeader("Content-Type", registry.contentType);
    res.send(await registry.metrics());
  });

  // ---- Versioned API ----
  const v1 = express.Router();
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
  app.use("/api/v1", v1);

  logger.info("AgroBridge API routes mounted");

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
