#!/usr/bin/env node
/**
 * Provisions a PostgreSQL database for the AgroBridge test/verification suite.
 * Idempotent: safe to re-run. Requires DATABASE_URL pointing at the target DB.
 *
 * Usage:
 *   DATABASE_URL=postgresql://postgres@localhost:5433/agrobridge node scripts/provision-postgres.mjs
 */
import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";

const url = process.env.DATABASE_URL;
if (!url?.startsWith("postgresql://") && !url?.startsWith("postgres://")) {
  console.error("Set DATABASE_URL to a postgresql:// connection string first.");
  process.exit(1);
}

const SCHEMA = "prisma/schema.postgresql.prisma";

// 1. Sync schema (idempotent)
execSync(`npx prisma db push --skip-generate --schema ${SCHEMA}`, { stdio: "inherit" });

// 2. Generate the PG-flavoured Prisma Client
execSync(`npx prisma generate --schema ${SCHEMA}`, { stdio: "inherit" });

// 3. Seed demo catalog (upserts are idempotent)
execSync("npx tsx prisma/seed.ts", { stdio: "inherit" });

console.log("PostgreSQL provisioning complete.");
