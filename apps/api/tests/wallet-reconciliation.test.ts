import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { copyFileSync, existsSync, unlinkSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * API-03: wallet reconciliation must actually catch corruption — through the
 * real CLI (`scripts/reconcile-wallet.mjs`), on BOTH dialects.
 *
 * F-31: this file used to `describe.skip` the whole suite under the PostgreSQL
 * profile while its comment implied a PG proof existed. It now runs on both
 * profiles:
 *
 *  - SQLite (default): every operation happens on a SCRATCH COPY of the suite
 *    database — fixtures are created there, pruned there, corrupted there, and
 *    the copy is deleted at the end. The suite database itself is only ever
 *    COPIED, never written, deleted from, or reconciled. Its path is derived
 *    from DATABASE_URL (`file:./test.db`, or whatever TEST_DB_FILE names)
 *    rather than hard-coded, so a private-database run reconciles the database
 *    it actually tests on.
 *  - PostgreSQL: a throwaway database is created on the provisioned server,
 *    migrated with the shipping postgres chain, exercised by the same three
 *    proofs, then dropped WITH (FORCE). Mirrors tests/reconciliation.test.ts.
 *
 * Local-execution gap (2026-11-10): this machine has a Docker CLI but no
 * running daemon and no standalone PostgreSQL, so the PG path was NOT executed
 * locally — it runs in CI's `API — Integration & Concurrency (PostgreSQL 17)`
 * job via vitest.config.pg.ts, which provisions the server. The SQLite path is
 * executed by the default suite.
 */

const apiRoot = process.cwd();
const databaseUrl = process.env.DATABASE_URL ?? "";
const isPg = databaseUrl.startsWith("postgres");

/** SQLite suite database, resolved like Prisma resolves a `file:./x.db` URL. */
function sqliteSuiteDb() {
  const rest = databaseUrl.replace(/^file:/, "");
  return rest.startsWith("./") ? path.resolve(apiRoot, "prisma", rest.slice(2)) : path.resolve(rest);
}

const SCRATCH_DB = path.resolve(apiRoot, "prisma", `qa-recon-scratch-${process.pid}.db`);
const SCRATCH_URL = `file:${SCRATCH_DB}`;
const SCRATCH_PG = `agrobridge_wallet_recon_${process.pid}`;
const scratchUrl = isPg ? databaseUrl.replace(/\/[^/]+$/, `/${SCRATCH_PG}`) : SCRATCH_URL;
const adminUrl = isPg ? databaseUrl.replace(/\/[^/]+$/, "/postgres") : "";

function nodeOnScratch(script: string): string {
  return execFileSync(
    process.platform === "win32" ? "node.exe" : "node",
    ["-e", script],
    { encoding: "utf8", env: { ...process.env, DATABASE_URL: scratchUrl } },
  );
}

function reconcile(): { code: number; output: string } {
  try {
    const out = execFileSync(process.platform === "win32" ? "node.exe" : "node", ["scripts/reconcile-wallet.mjs"], {
      cwd: apiRoot,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: scratchUrl },
    });
    return { code: 0, output: out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

beforeAll(async () => {
  if (isPg) {
    const admin = new PrismaClient({ datasourceUrl: adminUrl });
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH_PG}"`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${SCRATCH_PG}"`);
    await admin.$disconnect();
    execSync("npx prisma migrate deploy --schema prisma/postgres/schema.prisma", {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: scratchUrl },
      stdio: "pipe",
    });
    return;
  }
  copyFileSync(sqliteSuiteDb(), SCRATCH_DB);
}, 120_000);

afterAll(async () => {
  if (isPg) {
    const admin = new PrismaClient({ datasourceUrl: adminUrl });
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${SCRATCH_PG}" WITH (FORCE)`);
    await admin.$disconnect();
    return;
  }
  for (const suffix of ["", "-journal"]) {
    const p = `${SCRATCH_DB}${suffix}`;
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      /* Windows may briefly hold the engine's handle; the scratch is disposable */
    }
  }
});

describe("wallet reconciliation (API-03)", () => {
  it("a ledger-consistent wallet is never reported as a mismatch", async () => {
    // Fixtures live ONLY in the scratch: balance 100 paisa backed by a
    // 100-paisa CREDIT row — consistent by construction.
    nodeOnScratch(`
      const { PrismaClient } = require("@prisma/client");
      const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
      (async () => {
        await p.user.create({
          data: {
            id: "qa_wal_ok_u", phone: "01790000001", passwordHash: "x",
            fullName: "Recon Clean", status: "ACTIVE",
            wallet: { create: { id: "qa_wal_ok_w", balancePaisa: 100, heldPaisa: 0 } },
          },
        });
        await p.walletTransaction.create({
          data: { userId: "qa_wal_ok_u", direction: "CREDIT", amountPaisa: 100, balanceAfterPaisa: 100, reason: "opening" },
        });
        // Only the consistent wallet is in view, so the verdict measures the
        // invariant, not fixture noise from whatever else is in the scratch.
        await p.wallet.deleteMany({ where: { id: { not: "qa_wal_ok_w" } } });
        await p.$disconnect();
      })();
    `);

    const result = reconcile();
    expect(result.code, `expected a clean reconciliation, got: ${result.output}`).toBe(0);
    // The operator-facing verdict, not just the exit code.
    expect(result.output).toContain("reconcile-wallet: OK");
  });
});

describe("wallet reconciliation (API-03) — corruption", () => {
  it("a wallet whose balance diverges from its ledger is caught (exit 1, named mismatch)", async () => {
    // Prune back to only the corrupt wallet so the script's named-mismatch
    // report is deterministic (it prints at most ten).
    nodeOnScratch(`
      const { PrismaClient } = require("@prisma/client");
      const p = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
      (async () => {
        await p.wallet.deleteMany({});
        await p.walletTransaction.deleteMany({});
        await p.user.create({
          data: {
            id: "qa_wal_bad_u", phone: "01790000002", passwordHash: "x",
            fullName: "Recon Corrupt", status: "ACTIVE",
            wallet: { create: { id: "qa_wal_bad_w", balancePaisa: 100, heldPaisa: 0 } },
          },
        });
        await p.$disconnect();
      })();
    `);

    const result = reconcile();
    expect(result.code, "a diverging wallet must fail reconciliation").toBe(1);
    expect(result.output).toContain("qa_wal_bad_u");
  });

  it("verdicts are stable across runs (no state is consumed)", async () => {
    const first = reconcile();
    const second = reconcile();
    // The corrupt wallet exists after either run: the reconciler reports, never repairs.
    expect(first.output).toContain("qa_wal_bad_u");
    expect(second.output).toContain("qa_wal_bad_u");
    expect(first.code).toBe(second.code);
  });
});
