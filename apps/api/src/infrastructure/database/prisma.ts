import { PrismaClient } from "@prisma/client";
import { env, isProd } from "../../config/env.js";

declare global {
   
  var __prisma: PrismaClient | undefined;
}

/**
 * Applies the configured pool size to a PostgreSQL connection string (ARC-06).
 *
 * Prisma's only pool knob is the datasource URL — `PrismaClient` has no
 * `poolSize` option — and its default (`cpus * 2 + 1`) was 9 connections on the
 * machine audited for the 10k-concurrency report. That default is *per instance*,
 * so the fleet's total is (instances x 9) and nothing in the repository said so;
 * a deployment that scaled horizontally past the database's `max_connections`
 * would have discovered it as connection errors under load.
 *
 * String surgery rather than `new URL()` on purpose: re-serialising a URL
 * re-encodes the password, and a credential the operator pasted verbatim must
 * keep working byte for byte. Existing parameters are never overwritten — an
 * explicit `?connection_limit=` in DATABASE_URL still wins.
 *
 * SQLite URLs are returned untouched: the parameter is meaningless there and the
 * dev/test profile must not change behaviour.
 */
export function withPoolParams(
  url: string,
  connectionLimit?: number,
  poolTimeoutSeconds?: number,
): string {
  if (!/^postgres(ql)?:\/\//i.test(url)) return url;
  const additions: string[] = [];
  if (connectionLimit !== undefined && !/[?&]connection_limit=/.test(url)) {
    additions.push(`connection_limit=${connectionLimit}`);
  }
  if (poolTimeoutSeconds !== undefined && !/[?&]pool_timeout=/.test(url)) {
    additions.push(`pool_timeout=${poolTimeoutSeconds}`);
  }
  if (!additions.length) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${additions.join("&")}`;
}

const poolUrl = withPoolParams(env.DATABASE_URL, env.DATABASE_CONNECTION_LIMIT, env.DATABASE_POOL_TIMEOUT_SECONDS);

export const prisma =
  global.__prisma ??
  new PrismaClient({
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    // Passed only when a pool parameter was actually configured, so an
    // unconfigured deployment keeps the exact construction it had before.
    ...(poolUrl === env.DATABASE_URL ? {} : { datasources: { db: { url: poolUrl } } }),
  });

if (!isProd) global.__prisma = prisma;
