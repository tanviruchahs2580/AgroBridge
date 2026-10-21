import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "AgroBridge API started");
});

// Bound the socket lifecycle (F-09). Node's defaults hold a request for up to
// 300 s and headers for 60 s — longer than any client waits, which is how a
// queued request turns into a user staring at a spinner while the instance keeps
// the work alive. These values fail first, so the client's own timeout is not the
// thing that ends the request.
server.requestTimeout = env.REQUEST_TIMEOUT_MS;
server.headersTimeout = env.HEADERS_TIMEOUT_MS;
// Applied only when configured: the default (Node's 5 s) is the safe ordering in
// front of a 60 s load-balancer idle timeout. See config/env.ts.
if (env.KEEPALIVE_TIMEOUT_MS !== undefined) server.keepAliveTimeout = env.KEEPALIVE_TIMEOUT_MS;
// Opt-in for the same reason: a limit belongs where the fronting proxy is sized,
// because Node's accept queue is exactly the place F-05 measured as invisible to
// the in-process guard. Node's default is no limit.
if (env.SERVER_MAX_CONNECTIONS !== undefined) server.maxConnections = env.SERVER_MAX_CONNECTIONS;
logger.info(
  { requestTimeoutMs: server.requestTimeout, headersTimeoutMs: server.headersTimeout, keepAliveTimeoutMs: server.keepAliveTimeout },
  "http timeouts configured",
);

// A crash beats a corrupted state: log loudly, drain, exit non-zero.
process.on("unhandledRejection", (reason) => {
  // Same policy as uncaughtException below: a missed await must never leave a
  // half-written order or mis-sized wallet balance behind. Drain and exit.
  logger.error({ err: reason instanceof Error ? reason.stack : String(reason) }, "unhandled rejection — draining and exiting");
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 5_000).unref();
});
process.on("uncaughtException", (err) => {
  logger.error({ err: err.stack }, "uncaught exception — draining and exiting");
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 5_000).unref();
});

// Graceful shutdown — drain in-flight requests before exiting
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down gracefully");
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
