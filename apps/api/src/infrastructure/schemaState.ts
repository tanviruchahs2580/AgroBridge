import { prisma } from "./database/prisma.js";
import { logger } from "../shared/logging/logger.js";

/**
 * Which migration the running database has applied last.
 *
 * This is the readout the production deploy gate compares against the newest
 * migration in the repository (`deploy-verify.yml`, ADR-0007): "production
 * includes the reviewed commit" must also mean "production's schema includes the
 * reviewed migrations". Before this existed, the schema was the one artifact in
 * the release that nothing checked — three migrations sat unapplied in production
 * for two days while every gate stayed green.
 */
export interface SchemaState {
  /** false when the migrations table is absent (db push, a fresh SQLite file) or unreadable. */
  known: boolean;
  /** number of migrations recorded as finished; null when unknown */
  applied: number | null;
  /** chain-latest applied migration name; null when unknown */
  latest: string | null;
}

/** One readiness call per 60s per instance is enough — this must not become a DB hot spot. */
const CACHE_TTL_MS = 60_000;
let cache: { at: number; value: SchemaState } | null = null;

export async function readSchemaState(now: number = Date.now()): Promise<SchemaState> {
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.value;

  let value: SchemaState;
  try {
    const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL"
    );
    // Migration names lead with a timestamp and Prisma applies them in chain
    // order, so the lexicographic maximum is the applied-latest — the same
    // ordering `ls | sort | tail -1` gives on the repository side of the gate.
    value = { known: true, applied: rows.length, latest: rows.map((r) => r.migration_name).sort().pop() ?? null };
  } catch {
    // A truthful "unknown" is the right answer for a database that has no
    // migrations table — and it must never turn readiness into a 500.
    // Deliberately no error object: Prisma errors can carry the datasource URL.
    logger.warn("schema state unreadable — migrations table missing or database unreachable");
    value = { known: false, applied: null, latest: null };
  }

  cache = { at: now, value };
  return value;
}

/** Test seam: the cache would otherwise hide a changed database for a minute. */
export function resetSchemaStateCache(): void {
  cache = null;
}
