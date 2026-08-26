import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "AgroBridge API started");
});

// A crash beats a corrupted state: log loudly, drain, exit non-zero.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason instanceof Error ? reason.stack : String(reason) }, "unhandled rejection");
});
process.on("uncaughtException", (err) => {
  logger.error({ err: err.stack }, "uncaught exception — draining and exiting");
  server.close(() => process.exit(1));
  setTimeout(() => process.exit(1), 5_000).unref();
});

// Graceful shutdown (Section 35/48 operational hygiene)
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down gracefully");
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}
