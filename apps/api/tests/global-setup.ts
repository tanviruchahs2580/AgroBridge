import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Regenerates the Prisma client only when it can actually be stale.
 *
 * Running `prisma generate` unconditionally made this suite unusable on Windows
 * while a dev server was up: the running process holds
 * `query_engine-windows.dll.node`, the rename fails with `EPERM`, and the whole
 * suite dies with an error that says nothing about the real cause. Four separate
 * sessions lost time to it before this guard existed.
 *
 * Behaviour:
 *  - client missing                     → generate (failure is fatal — the suite cannot run)
 *  - client generated for another        → generate (mtime alone cannot see the
 *    dialect (PG client, SQLite run)          dialect; the 2026-10-19 audit
 *                                              reproduced this trap — AUD-166)
 *  - schema newer than the client       → generate (failure is fatal and says why)
 *  - client current and same dialect    → skip generation entirely
 */
function clientDialect(clientDir: string): string | null {
  try {
    // `prisma generate` copies the source schema into the client output dir;
    // its datasource provider is the ground truth for what this client speaks.
    const copied = readFileSync(join(clientDir, "schema.prisma"), "utf8");
    const match = /provider\s*=\s*"([a-z]+)"/.exec(copied);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function ensurePrismaClient(schemaPath: string, clientDir: string, neededDialect: string) {
  const generated = existsSync(clientDir);
  if (!generated) {
    execSync("npx prisma generate --schema prisma/schema.prisma", { stdio: "inherit" });
    return;
  }

  const dialect = clientDialect(clientDir);
  if (dialect && dialect !== neededDialect) {
    console.log(`[global-setup] Prisma client was generated for ${dialect} but this run needs ${neededDialect} — regenerating`);
  } else {
    const schemaIsNewer = statSync(schemaPath).mtimeMs > statSync(clientDir).mtimeMs;
    if (!schemaIsNewer) {
      console.log("[global-setup] Prisma client is current for this schema — skipping generate");
      return;
    }
  }

  try {
    execSync("npx prisma generate --schema prisma/schema.prisma", { stdio: "inherit" });
  } catch (e) {
    throw new Error(
      `prisma generate failed while the generated client does not match this run's dialect/schema.\n` +
        `On Windows this usually means a dev server is running and holding the query engine DLL:\n` +
        `stop \`npm run dev --workspace apps/api\` and run the suite again.\n` +
        `Original error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Prepares a clean database before the suite runs.
 * - SQLite profile (default): recreate test.db via migrations + demo seed.
 * - PostgreSQL profile (DATABASE_URL starts with postgresql://): assume an
 *   already-provisioned database (see scripts/provision-postgres.mjs) — only
 *   verify connectivity here.
 */
export default function globalSetup() {
  const url = process.env.DATABASE_URL ?? "";
  const schemaPath = fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url));
  const clientDir = fileURLToPath(new URL("../../../node_modules/.prisma/client", import.meta.url));

  if (url.startsWith("postgresql://") || url.startsWith("postgres://")) {
    execSync('npx tsx -e "import(\'@prisma/client\').then(async ({ PrismaClient }) => { const p = new PrismaClient(); await p.$queryRaw`SELECT 1`; await p.$disconnect(); console.log(\'PG ready\'); })"', {
      stdio: "inherit",
    });
    return;
  }

  // SQLite path — ensure client matches the SQLite schema (host may have PG client from prior provision)
  ensurePrismaClient(schemaPath, clientDir, "sqlite");
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
