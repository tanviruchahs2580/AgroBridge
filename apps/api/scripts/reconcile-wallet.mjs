#!/usr/bin/env node
/**
 * Daily wallet reconciliation:
 *  1. SUM(CREDIT) - SUM(DEBIT) must equal wallet.balancePaisa.
 *  2. wallet.heldPaisa must equal the sum of PENDING withdrawal rows.
 * Run via cron: 0 4 * * * cd /srv/agrobridge/apps/api && node scripts/reconcile-wallet.mjs
 * Exits 1 on mismatch (alert), 0 when clean.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const mismatches = [];

const wallets = await prisma.wallet.findMany({ select: { userId: true, balancePaisa: true, heldPaisa: true } });
for (const w of wallets) {
  const credits = await prisma.walletTransaction.aggregate({ where: { userId: w.userId, direction: "CREDIT" }, _sum: { amountPaisa: true } });
  const debits = await prisma.walletTransaction.aggregate({ where: { userId: w.userId, direction: "DEBIT" }, _sum: { amountPaisa: true } });
  const computed = (credits._sum.amountPaisa ?? 0) - (debits._sum.amountPaisa ?? 0);
  if (computed !== w.balancePaisa) mismatches.push({ userId: w.userId, stored: w.balancePaisa, computed });
  const pending = await prisma.withdrawal.aggregate({ where: { userId: w.userId, status: "PENDING" }, _sum: { amountPaisa: true } });
  if ((pending._sum.amountPaisa ?? 0) !== w.heldPaisa) {
    mismatches.push({ userId: w.userId, heldStored: w.heldPaisa, heldComputed: pending._sum.amountPaisa ?? 0 });
  }
}

if (mismatches.length) {
  console.error(`reconcile-wallet: ${mismatches.length} mismatches`, JSON.stringify(mismatches.slice(0, 10), null, 2));
  await prisma.$disconnect();
  process.exit(1);
}
console.log(`reconcile-wallet: OK — ${wallets.length} wallets verified`);
await prisma.$disconnect();
