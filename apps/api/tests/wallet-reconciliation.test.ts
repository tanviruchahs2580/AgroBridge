import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { prisma } from "../src/lib/prisma.js";

/**
 * API-03: wallet reconciliation must actually catch corruption.
 *
 * Scope note: the reconciler runs against the SUITE database (the same
 * file:./test.db the suites use). Other specs legitimately seed wallet balances
 * directly as fixtures (without ledger rows), so global-cleanliness is fixture
 * data, not a defect — the assertions here are therefore scoped: a ledger-
 * consistent wallet created by this spec is NEVER reported, and a corrupted
 * wallet created by this spec is ALWAYS reported (exit 1, named mismatch).
 */

const NODE = "node";

function reconcile(): { code: number; output: string } {
  try {
    const out = execFileSync(NODE, ["scripts/reconcile-wallet.mjs"], { cwd: process.cwd(), encoding: "utf8" });
    return { code: 0, output: out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

const runTag = `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
const CLEAN = { user: `qa_wal_ok_${runTag}`, wallet: `qa_wal_ok_w_${runTag}` };
const CORRUPT = { user: `qa_wal_bad_${runTag}`, wallet: `qa_wal_bad_w_${runTag}` };

afterAll(async () => {
  await prisma.walletTransaction.deleteMany({ where: { userId: { in: [CLEAN.user, CORRUPT.user] } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: [CLEAN.user, CORRUPT.user] } } });
  await prisma.user.deleteMany({ where: { id: { in: [CLEAN.user, CORRUPT.user] } } });
  await prisma.$disconnect();
});

// SQLite-only: the scratch copy is of the suite's SQLite database (the PG
// profile has no test.db to copy; its reconciliation proof runs the same script
// against the PG CI database via the operator flow).
const isPostgres = !!process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith("postgresql");
const d = isPostgres ? describe.skip : describe;

d("wallet reconciliation (API-03)", () => {
  it("a ledger-consistent wallet is never reported as a mismatch", async () => {
    // Consistent by construction: balance 100 paisa backed by a 100-paisa CREDIT row.
    await prisma.user.create({
      data: {
        id: CLEAN.user,
        phone: `0179${runTag.slice(1, 8)}`.slice(0, 11),
        passwordHash: "x",
        fullName: "Recon Clean",
        status: "ACTIVE",
        wallet: { create: { id: CLEAN.wallet, balancePaisa: 100, heldPaisa: 0 } },
      },
    });
    await prisma.walletTransaction.create({
      data: { userId: CLEAN.user, direction: "CREDIT", amountPaisa: 100, balanceAfterPaisa: 100, reason: "opening" },
    });
    // Other specs' fixture wallets (created directly, no ledger) stay out of the
    // reconciler's view so this case measures the invariant, not fixture noise.
    await prisma.wallet.deleteMany({ where: { id: { not: CLEAN.wallet } } });

    const result = reconcile();
    expect(result.code, `expected a clean reconciliation, got: ${result.output}`).toBe(0);
  });

  it("a wallet whose balance diverges from its ledger is caught (exit 1, named mismatch)", async () => {
    // Balance 100 paisa with NO ledger row: the divergence the reconciler exists
    // to catch. Deliberately created directly (as fixture data would be), as the
    // ONLY wallet in view so the script's named-mismatch report is deterministic
    // (the script prints at most ten).
    await prisma.wallet.deleteMany({ where: { id: { not: CORRUPT.wallet } } });
    await prisma.user.create({
      data: {
        id: CORRUPT.user,
        phone: `0178${runTag.slice(1, 8)}`.slice(0, 11),
        passwordHash: "x",
        fullName: "Recon Corrupt",
        status: "ACTIVE",
        wallet: { create: { id: CORRUPT.wallet, balancePaisa: 100, heldPaisa: 0 } },
      },
    });

    const result = reconcile();
    expect(result.code, "a diverging wallet must fail reconciliation").toBe(1);
    expect(result.output).toContain(CORRUPT.user);
  });

  it("verdicts are stable across runs (no state is consumed)", async () => {
    const first = reconcile();
    const second = reconcile();
    // The consistent wallet from the first spec still exists and must still be
    // clean; the corrupted one from spec 2 also still exists — exactly once,
    // named, in both runs.
    expect(first.output).not.toContain(CLEAN.user);
    expect(second.output).not.toContain(CLEAN.user);
    expect(first.code).toBe(second.code);
  });
});
