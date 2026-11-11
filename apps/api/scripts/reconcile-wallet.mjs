#!/usr/bin/env node
/**
 * Daily wallet reconciliation:
 *  1. SUM(CREDIT) - SUM(DEBIT) must equal wallet.balancePaisa.
 *  2. wallet.heldPaisa must equal the sum of PENDING withdrawal rows.
 * Exits 1 on mismatch (alert), 0 when clean.
 *
 * How it actually runs (2026-11-10, F-20 — the previous line here said
 * `Run via cron: 0 4 * * * cd /srv/agrobridge/...`, and no such host exists;
 * production is Vercel + Neon):
 *   - scheduled: the Vercel cron in apps/api/vercel.json
 *     (`/api/v1/ops/reconcile-wallet`, `0 4 * * *`) invokes the CRON_SECRET-guarded
 *     ops endpoint, which calls the exported `reconcileWallets` below. Needs
 *     CRON_SECRET set in the API project's environment; without it the endpoint
 *     fails closed with 503 and nothing is reconciled.
 *   - manual: `node scripts/reconcile-wallet.mjs` from apps/api with DATABASE_URL
 *     pointing at the database to check (see docs/runbooks/failed-transaction-recovery.md).
 *
 * The check itself is exported as `reconcileWallets` so
 * tests/reconciliation.test.ts exercises this exact code; importing the module
 * connects nothing and exits nothing — the CLI behaviour lives in the main
 * guard below.
 */
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";

/**
 * Compares every wallet's stored balance/hold against the ledger and the
 * PENDING withdrawal rows.
 *
 * @param {import("@prisma/client").PrismaClient} client
 * @returns {Promise<{ walletsChecked: number; mismatches: Record<string, unknown>[] }>}
 */
export async function reconcileWallets(client) {
  const mismatches = [];
  const wallets = await client.wallet.findMany({ select: { userId: true, balancePaisa: true, heldPaisa: true } });
  for (const w of wallets) {
    const credits = await client.walletTransaction.aggregate({ where: { userId: w.userId, direction: "CREDIT" }, _sum: { amountPaisa: true } });
    const debits = await client.walletTransaction.aggregate({ where: { userId: w.userId, direction: "DEBIT" }, _sum: { amountPaisa: true } });
    const computed = (credits._sum.amountPaisa ?? 0) - (debits._sum.amountPaisa ?? 0);
    if (computed !== w.balancePaisa) mismatches.push({ userId: w.userId, stored: w.balancePaisa, computed });
    const pending = await client.withdrawal.aggregate({ where: { userId: w.userId, status: "PENDING" }, _sum: { amountPaisa: true } });
    if ((pending._sum.amountPaisa ?? 0) !== w.heldPaisa) {
      mismatches.push({ userId: w.userId, heldStored: w.heldPaisa, heldComputed: pending._sum.amountPaisa ?? 0 });
    }
  }
  return { walletsChecked: wallets.length, mismatches };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const prisma = new PrismaClient();
  const { walletsChecked, mismatches } = await reconcileWallets(prisma);
  if (mismatches.length) {
    console.error(`reconcile-wallet: ${mismatches.length} mismatches`, JSON.stringify(mismatches.slice(0, 10), null, 2));
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log(`reconcile-wallet: OK — ${walletsChecked} wallets verified`);
  await prisma.$disconnect();
}
