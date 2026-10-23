/**
 * Case-insensitive substring match across BOTH dialects (AUD-V3).
 *
 * SQLite's LIKE is ASCII-case-insensitive; PostgreSQL's is case-sensitive —
 * so the same `contains` filter silently behaved differently in dev (SQLite)
 * and production (PG). `mode: "insensitive"` restores parity on PostgreSQL
 * but is REJECTED by Prisma on SQLite, hence the dialect switch. Bengali
 * script has no case, so the toggle only affects ASCII search terms.
 */
import { env } from "../../config/env.js";

export const isPostgres = env.DATABASE_URL.startsWith("postgres");

export function ciContains(value: string): { contains: string; mode?: "insensitive" } {
  return isPostgres ? { contains: value, mode: "insensitive" as const } : { contains: value };
}
