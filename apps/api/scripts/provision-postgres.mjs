#!/usr/bin/env node
/**
 * Provisions a PostgreSQL database for the AgroBridge test/verification suite.
 * Idempotent: safe to re-run. Requires DATABASE_URL pointing at the target DB.
 *
 * Usage:
 *   DATABASE_URL=postgresql://postgres@localhost:5433/agrobridge node scripts/provision-postgres.mjs
 *
 * Since 2026-10-18 this provisions from **the schema and migration chain
 * production runs** (`prisma/postgres/`, the copy with the serverless engine
 * target and the chain `scripts/deploy-migrations.mjs` applies), not from a
 * `db push` against the standalone `prisma/schema.postgresql.prisma` copy.
 *
 * Why it matters: with `db push` the PostgreSQL test job built its database from
 * a schema copy that production never runs, and recorded no migrations — so
 * nothing in CI proved the migration chain could be applied at all, while
 * production's own schema state went unchecked for two days (ADR-0007). The job
 * now exercises the shipping artifact, and `/ready` reports a real schema
 * readout in both test profiles.
 */
import { execSync } from "node:child_process";

const url = process.env.DATABASE_URL;
if (!url?.startsWith("postgresql://") && !url?.startsWith("postgres://")) {
  console.error("Set DATABASE_URL to a postgresql:// connection string first.");
  process.exit(1);
}

/** The production PostgreSQL profile: schema + the migration chain beside it. */
const SCHEMA = "prisma/postgres/schema.prisma";

// 1. Apply the migration chain (the artifact that ships; idempotent, and on an
//    empty database it is also the proof that the chain is complete).
execSync(`npx prisma migrate deploy --schema ${SCHEMA}`, { stdio: "inherit" });

// 2. Generate the PG-flavoured Prisma Client (binaryTargets includes native).
execSync(`npx prisma generate --schema ${SCHEMA}`, { stdio: "inherit" });

// 3. Seed demo catalog (upserts are idempotent)
execSync("npx tsx prisma/seed.ts", { stdio: "inherit" });

console.log("PostgreSQL provisioning complete (from the production schema + migration chain).");
