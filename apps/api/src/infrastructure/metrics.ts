import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from "prom-client";
import type { Request, Response, NextFunction } from "express";

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

// Default metrics (CPU, memory) – lightweight
collectDefaultMetrics({ register: registry, prefix: "agrobridge_" });

export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const route = (req.route?.path as string) || req.path;
    const labels = { method: req.method, route, status: String(res.statusCode) };
    httpRequestsTotal.inc(labels);
    const duration = Number(process.hrtime.bigint() - start) / 1e9;
    httpRequestDuration.observe(labels, duration);
  });
  next();
}
