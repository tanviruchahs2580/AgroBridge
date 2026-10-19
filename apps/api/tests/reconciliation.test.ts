import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { runSeed } from "../prisma/seed.js";
// @ts-expect-error -- plain-JS production script (scripts/reconcile-wallet.mjs has no
// type declarations); its exported shape is pinned by the assertions below.
import { reconcileWallets } from "../scripts/reconcile-wallet.mjs";

/**
 * API-03: the daily wallet reconciliation (scripts/reconcile-wallet.mjs) must
 * find a freshly seeded database clean, and must report a corrupted balance
 * exactly once, keyed by the wallet's user id.
 *
 * The test runs against its own scratch SQLite database (migrated + seeded via
 * the real seed functions) instead of the shared suite DB: other test files
 * deliberately seed bare wallet balances as fixtures, so the shared DB is not a
 * "seeded-clean state". Here the seeded state is exactly what a deploy creates,
 * and the test exercises the real script's exported core.
 */
const apiRoot = fileURLToPath(new URL("..", import.meta.url));
const scratchDbName = `recon-scratch-${process.pid}.db`;
const scratchDbPath = fileURLToPath(new URL(`../prisma/${scratchDbName}`, import.meta.url));
const scratchUrl = `file:./${scratchDbName}`; // relative to prisma/, like prisma/test.db

interface Mismatch {
  userId: string;
  stored?: number;
  computed?: number;
  heldStored?: number;
  heldComputed?: number;
}
interface ReconcileResult {
  walletsChecked: number;
  mismatches: Mismatch[];
}

let client: PrismaClient;

async function reconcile(): Promise<ReconcileResult> {
  return (await reconcileWallets(client)) as ReconcileResult;
}

beforeAll(async () => {
  execSync("npx prisma migrate deploy", {
    cwd: apiRoot,
    env: { ...process.env, DATABASE_URL: scratchUrl },
    stdio: "pipe",
  });
  client = new PrismaClient({ datasourceUrl: scratchUrl });
  await runSeed(client, { NODE_ENV: "test" }, () => {}, () => {});
}, 120_000);

afterAll(async () => {
  await client?.$disconnect();
  for (const p of [scratchDbPath, `${scratchDbPath}-journal`]) {
    if (existsSync(p)) rmSync(p);
  }
});

describe("wallet reconciliation (API-03)", () => {
  it("a seeded-clean database reports 0 discrepancies", async () => {
    const { walletsChecked, mismatches } = await reconcile();
    expect(walletsChecked).toBeGreaterThan(0);
    expect(mismatches).toEqual([]);
  });

  it("a corrupted balance is reported once with the wallet's user id, and restoring it reports clean again", async () => {
    // The seeded demo farmer's wallet carries a balance and its matching
    // ledger row; corrupt the stored balance by one artificial amount.
    const farmer = await client.user.findUniqueOrThrow({ where: { phone: "01700000002" } });
    const walletBefore = await client.wallet.findUniqueOrThrow({ where: { userId: farmer.id } });

    const corrupted = walletBefore.balancePaisa + 12_345;
    await client.wallet.update({ where: { userId: farmer.id }, data: { balancePaisa: corrupted } });
    try {
      const { mismatches } = await reconcile();
      // Exactly one row: the balance deficiency of the wallet this test corrupted.
      expect(mismatches).toEqual([{ userId: farmer.id, stored: corrupted, computed: walletBefore.balancePaisa }]);
    } finally {
      await client.wallet.update({ where: { userId: farmer.id }, data: { balancePaisa: walletBefore.balancePaisa } });
    }

    const restored = await reconcile();
    expect(restored.mismatches).toEqual([]);
  }, 30_000);
});
