import { afterAll, describe, expect, it } from "vitest";
import { copyFileSync, existsSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * API-03: wallet reconciliation must actually catch corruption.
 *
 * The reconciler reads whatever DATABASE_URL points at, so every operation in
 * this spec happens on a SCRATCH COPY of the suite database: fixtures are
 * created there, pruned there, corrupted there, and the copy is deleted at the
 * end. The suite database itself is only ever CLOSED for the copy — never
 * written, deleted from, or reconciled. Besides isolation, that is what makes
 * the run parallel-safe: other specs' fixture wallets (created directly, no
 * ledger rows) stay fixtures, and this spec stays deterministic regardless of
 * what they do.
 */

const SUITE_DB = path.resolve(process.cwd(), "prisma", "test.db");
const SCRATCH_DB = path.resolve(process.cwd(), "prisma", `qa-recon-scratch-${process.pid}.db`);
const SCRATCH_URL = `file:${SCRATCH_DB}`;

function nodeOnScratch(script: string): string {
  return execFileSync(
    process.platform === "win32" ? "node.exe" : "node",
    ["-e", script],
    { encoding: "utf8", env: { ...process.env, DATABASE_URL: SCRATCH_URL } },
  );
}

function reconcile(): { code: number; output: string } {
  try {
    const out = execFileSync(process.platform === "win32" ? "node.exe" : "node", ["scripts/reconcile-wallet.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: SCRATCH_URL },
    });
    return { code: 0, output: out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

afterAll(() => {
  for (const suffix of ["", "-journal"]) {
    const p = `${SCRATCH_DB}${suffix}`;
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      /* Windows may briefly hold the engine's handle; the scratch is disposable */
    }
  }
});

// SQLite-only: the scratch copy is of the suite's SQLite database (the PG
// profile has no test.db to copy; its reconciliation proof runs the same script
// against the PG CI database via the operator flow).
const isPostgres = !!process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith("postgresql");
const d = isPostgres ? describe.skip : describe;

d("wallet reconciliation (API-03)", () => {
  it("a ledger-consistent wallet is never reported as a mismatch", async () => {
    copyFileSync(SUITE_DB, SCRATCH_DB);
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
        // invariant, not fixture noise from whichever specs ran before the copy.
        await p.wallet.deleteMany({ where: { id: { not: "qa_wal_ok_w" } } });
        await p.$disconnect();
      })();
    `);

    const result = reconcile();
    expect(result.code, `expected a clean reconciliation, got: ${result.output}`).toBe(0);
  });
});

d("wallet reconciliation (API-03) — corruption", () => {
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
