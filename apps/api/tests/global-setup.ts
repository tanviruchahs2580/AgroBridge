import { execSync } from "node:child_process";
import { existsSync, openSync, closeSync, readFileSync, rmSync, statSync, unlinkSync, writeSync } from "node:fs";
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

const LOCK_FILE = fileURLToPath(new URL("../prisma/.test-db.lock", import.meta.url));
export const TEST_DB_LOCK = LOCK_FILE;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // ESRCH → no such process. EPERM → alive but not ours (still alive).
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Exclusive lock around the SQLite test database.
 *
 * The suite deletes and recreates its database in `globalSetup`, and
 * `fileParallelism: false` only orders files *within* one run. Two runs on one
 * checkout — a developer running a single file while the full suite is in
 * flight, or two agents working in parallel — therefore destroyed each other's
 * database. The 2026-11-10 audit reproduced this: 50 failing tests across 15
 * files, every failure reading `The table main.User does not exist`, from a
 * concurrent run's `globalSetup`.
 *
 * The lock is advisory but fail-fast: a second run stops with an actionable
 * message instead of silently corrupting the first. A lock whose owning process
 * has exited (SIGKILL, crash, CI timeout) is detected and reclaimed, so a stale
 * file can never wedge the suite permanently. Set `TEST_DB_FILE` to run against
 * a private database and skip the lock entirely (see docs/testing.md).
 */
function acquireDbLock(): void {
  const payload = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(LOCK_FILE, "wx");
      writeSync(fd, payload);
      closeSync(fd);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }

    let ownerPid: number | null = null;
    try {
      ownerPid = (JSON.parse(readFileSync(LOCK_FILE, "utf8")) as { pid?: number }).pid ?? null;
    } catch {
      ownerPid = null; // unreadable/partial lock — treat as stale
    }

    if (ownerPid !== null && isProcessAlive(ownerPid)) {
      throw new Error(
        `Another test run (pid ${ownerPid}) is already using the SQLite test database.\n` +
          `Both runs share apps/api/prisma/test.db, which this suite deletes and recreates —\n` +
          `running them together produces "The table main.User does not exist" in whichever\n` +
          `run lost the race, and that error looks like a product regression.\n\n` +
          `Wait for the other run to finish, or run this one against a private database:\n` +
          `  TEST_DB_FILE=file:./my-run.db npm run test --workspace apps/api\n`,
      );
    }

    console.log(`[global-setup] reclaiming stale test-db lock (owner pid ${ownerPid ?? "unknown"} is gone)`);
    try {
      unlinkSync(LOCK_FILE);
    } catch {
      // Someone else won the reclaim race; the next loop iteration re-checks.
    }
  }

  throw new Error(`Could not acquire ${LOCK_FILE} after reclaiming a stale lock.`);
}

export function releaseDbLock(): void {
  try {
    unlinkSync(LOCK_FILE);
  } catch {
    // Not held (PG profile, or already reclaimed) — nothing to do.
  }
}

/**
 * Prepares a clean database before the suite runs.
 * - SQLite profile (default): recreate the test database via migrations + demo seed.
 * - PostgreSQL profile (DATABASE_URL starts with postgresql://): assume an
 *   already-provisioned database (see scripts/provision-postgres.mjs) — only
 *   verify connectivity here.
 *
 * Returns the teardown, which is how vitest releases the lock. Note: vitest 4
 * has **no** `globalTeardown` config key (it was removed; declaring it is a
 * `TS2769` and a silent no-op — verified against vitest 4.1.12's distributed
 * types, which contain no such option). Returning the function from the global
 * setup's default export is the version-agnostic contract, so the lock is
 * released on the normal path and only SIGKILL/crash needs reclamation.
 */
export default function globalSetup() {
  const url = process.env.DATABASE_URL ?? "";
  const schemaPath = fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url));
  const clientDir = fileURLToPath(new URL("../../../node_modules/.prisma/client", import.meta.url));

  if (url.startsWith("postgresql://") || url.startsWith("postgres://")) {
    execSync('npx tsx -e "import(\'@prisma/client\').then(async ({ PrismaClient }) => { const p = new PrismaClient(); await p.$queryRaw`SELECT 1`; await p.$disconnect(); console.log(\'PG ready\'); })"', {
      stdio: "inherit",
    });
    return () => {};
  }

  // SQLite path — ensure client matches the SQLite schema (host may have PG client from prior provision)
  ensurePrismaClient(schemaPath, clientDir, "sqlite");

  // A private database (TEST_DB_FILE) is single-runner by construction; the
  // default shared test.db needs the lock.
  const privateDb = process.env.TEST_DB_FILE;
  const dbRel = privateDb ?? "file:./test.db";
  if (!privateDb) acquireDbLock();

  // Only the `file:./name.db` form resolves inside prisma/ (Prisma resolves a
  // relative SQLite URL against the schema's directory). Anything else is the
  // caller's business — migrate deploy will create it, we just must not delete
  // a path we cannot reason about.
  if (dbRel.startsWith("file:./")) {
    const dbPath = fileURLToPath(new URL(`../prisma/${dbRel.slice("file:./".length)}`, import.meta.url));
    for (const p of [dbPath, dbPath + "-journal"]) {
      if (existsSync(p)) rmSync(p);
    }
  }

  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = dbRel;
  execSync("npx prisma migrate deploy", { stdio: "inherit" });
  // Deterministic demo catalog (products/services/plans) required by journey tests
  execSync("npx prisma db seed", { stdio: "inherit" });

  return () => {
    if (!privateDb) releaseDbLock();
  };
}
