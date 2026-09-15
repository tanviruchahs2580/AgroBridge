#!/usr/bin/env node
/**
 * Dialect-aware migration deploy (QA 2026-09-15; P1: the live PostgreSQL DB was
 * originally created with `prisma db push`, so its _prisma_migrations table is
 * empty and a naive `migrate deploy` fails on the init migration with
 * "table already exists").
 *
 * Behavior:
 *  - SQLite URL (dev/test): plain `prisma migrate deploy` (SQLite chain).
 *  - PostgreSQL URL:
 *      1. For each PG migration, probe whether its schema artifacts already
 *         exist in the target DB; if so, mark it applied via the Prisma-native
 *         `migrate resolve --applied` (baseline procedure).
 *      2. Then `migrate deploy` applies whatever is genuinely missing
 *         (e.g. the heldPaisa ALTER on the live DB; full chain on a fresh DB).
 *  Idempotent: re-running is a no-op when everything is applied.
 *
 * Usage: DATABASE_URL=... node scripts/deploy-migrations.mjs
 */
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

const url = process.env.DATABASE_URL ?? "";
const PG_SCHEMA = "prisma/postgres/schema.prisma";
const isPostgres = url.startsWith("postgresql://") || url.startsWith("postgres://");

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

if (!isPostgres) {
  run("npx prisma migrate deploy");
  process.exit(0);
}

/** migration name -> predicate proving it is applied (must return > 0). */
const PROBES = {
  "20260915071201_init_postgres":
    "SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='User'",
  "20260915071238_wallet_held_paisa":
    "SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_schema='public' AND table_name='Wallet' AND column_name='heldPaisa'",
};

const prisma = new PrismaClient();
try {
  let recorded = [];
  try {
    recorded = await prisma.$queryRawUnsafe(
      "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL"
    );
  } catch {
    recorded = []; // table absent on a pre-baseline DB
  }
  const recordedSet = new Set(recorded.map((r) => r.migration_name));

  for (const [name, probe] of Object.entries(PROBES)) {
    if (recordedSet.has(name)) {
      console.log(`[deploy-migrations] ${name}: already recorded as applied`);
      continue;
    }
    let appliedArtifact = false;
    try {
      const rows = await prisma.$queryRawUnsafe(probe);
      appliedArtifact = Number(rows?.[0]?.n ?? 0) > 0;
    } catch {
      appliedArtifact = false; // fresh DB / not a prisma DB
    }
    if (appliedArtifact) {
      console.log(`[deploy-migrations] ${name}: artifacts present -> marking applied`);
      execSync(`npx prisma migrate resolve --applied ${name} --schema ${PG_SCHEMA}`, { stdio: "inherit" });
    } else {
      console.log(`[deploy-migrations] ${name}: artifacts missing -> deploy will apply it`);
    }
  }
} finally {
  await prisma.$disconnect();
}

run(`npx prisma migrate deploy --schema ${PG_SCHEMA}`);
console.log("[deploy-migrations] done");
