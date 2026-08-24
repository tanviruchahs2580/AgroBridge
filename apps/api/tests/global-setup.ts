import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Prepares a clean database before the suite runs.
 * - SQLite profile (default): recreate test.db via migrations + demo seed.
 * - PostgreSQL profile (DATABASE_URL starts with postgresql://): assume an
 *   already-provisioned database (see scripts/provision-postgres.mjs) — only
 *   verify connectivity here.
 */
export default function globalSetup() {
  const url = process.env.DATABASE_URL ?? "";

  if (url.startsWith("postgresql://") || url.startsWith("postgres://")) {
    execSync('npx tsx -e "import(\'@prisma/client\').then(async ({ PrismaClient }) => { const p = new PrismaClient(); await p.$queryRaw`SELECT 1`; await p.$disconnect(); console.log(\'PG ready\'); })"', {
      stdio: "inherit",
    });
    return;
  }

  // SQLite path
  const dbPath = fileURLToPath(new URL("../prisma/test.db", import.meta.url));
  for (const p of [dbPath, dbPath + "-journal"]) {
    if (existsSync(p)) rmSync(p);
  }

  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = process.env.DATABASE_URL ?? "file:./test.db";
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
  // Deterministic demo catalog (products/services/plans) required by journey tests
  execSync("npx prisma db seed", { stdio: "inherit" });
}
