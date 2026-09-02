import { prisma } from "../../lib/prisma.js";
import { notFound, phoneNotVerified, unprocessable } from "../../lib/errors.js";
import { isProd } from "../../config/env.js";
import { refNo } from "../../lib/money.js";
import { getActiveMembership } from "../../lib/membership.js";
import { audit } from "../../middleware/audit.js";
import type { TransactionClient } from "./payment.repository.js";

/**
 * Wallet domain service — pure business logic, no Express coupling.
 * Handles credit/debit, ledger entries (single + double-entry ready),
 * balance checks with pending-withdrawal holds, and withdrawal requests.
 */

export function maskDestination(phone: string): string {
  if (!phone || phone.length < 7) return "***";
  return `${phone.slice(0, 3)}***${phone.slice(-4)}`;
}

export const MIN_WITHDRAWAL_PAISA = 10_000;

type LedgerDirection = "CREDIT" | "DEBIT";

export type LedgerEntryInput = {
  userId: string;
  direction: LedgerDirection;
  amountPaisa: number;
  reason: string;
  balanceAfterPaisa: number;
  refType?: string;
  refId?: string;
};

// ---------------------------------------------------------------------------
// Low-level wallet helpers
// ---------------------------------------------------------------------------

export async function getOrCreateWallet(userId: string, tx?: TransactionClient) {
  const client = (tx ?? prisma) as typeof prisma;
  return client.wallet.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

export async function getWalletWithTransactions(userId: string) {
  const [wallet, transactions] = await Promise.all([
    prisma.wallet.upsert({ where: { userId }, update: {}, create: { userId } }),
    prisma.walletTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  return { balancePaisa: wallet.balancePaisa, transactions };
}

export async function getAvailableBalance(userId: string, tx?: TransactionClient): Promise<number> {
  const client = (tx ?? prisma) as typeof prisma;
  const wallet = await client.wallet.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
  const pending = await client.withdrawal.aggregate({
    where: { userId, status: { in: ["PENDING", "APPROVED"] } },
    _sum: { amountPaisa: true },
  });
  const held = pending._sum.amountPaisa ?? 0;
  return wallet.balancePaisa - held;
}

// ---------------------------------------------------------------------------
// Ledger — single entry + double-entry scaffold
// ---------------------------------------------------------------------------

export async function createLedgerEntry(input: LedgerEntryInput, tx?: TransactionClient) {
  const client = (tx ?? prisma) as typeof prisma;
  return client.walletTransaction.create({
    data: {
      userId: input.userId,
      direction: input.direction,
      amountPaisa: input.amountPaisa,
      reason: input.reason,
      balanceAfterPaisa: input.balanceAfterPaisa,
      refType: input.refType,
      refId: input.refId,
    },
  });
}

/**
 * Double-entry helper — creates paired DEBIT + CREDIT entries linked by
 * the same ref. Current schema stores single-sided entries; this wrapper
 * prepares the codebase for a true double-entry migration by ensuring
 * both sides are written atomically when a `counterpartyUserId` is supplied.
 * When no counterparty is given it degrades to a single entry (backward compat).
 */
export async function createDoubleEntry(
  params: {
    amountPaisa: number;
    reason: string;
    debitUserId: string;
    creditUserId?: string;
    refType?: string;
    refId?: string;
  },
  tx: TransactionClient,
): Promise<void> {
  // Debit side — always present (source)
  const debitWallet = await tx.wallet.upsert({
    where: { userId: params.debitUserId },
    update: { balancePaisa: { decrement: params.amountPaisa } },
    create: { userId: params.debitUserId, balancePaisa: -params.amountPaisa },
  });
  await tx.walletTransaction.create({
    data: {
      userId: params.debitUserId,
      direction: "DEBIT",
      amountPaisa: params.amountPaisa,
      reason: params.reason,
      balanceAfterPaisa: debitWallet.balancePaisa,
      refType: params.refType,
      refId: params.refId,
    },
  });

  // Credit side — optional counterparty (e.g., platform escrow)
  if (params.creditUserId && params.creditUserId !== params.debitUserId) {
    const creditWallet = await tx.wallet.upsert({
      where: { userId: params.creditUserId },
      update: { balancePaisa: { increment: params.amountPaisa } },
      create: { userId: params.creditUserId, balancePaisa: params.amountPaisa },
    });
    await tx.walletTransaction.create({
      data: {
        userId: params.creditUserId,
        direction: "CREDIT",
        amountPaisa: params.amountPaisa,
        reason: params.reason,
        balanceAfterPaisa: creditWallet.balancePaisa,
        refType: params.refType,
        refId: params.refId,
      },
    });
  }
}

export async function creditWallet(
  userId: string,
  amountPaisa: number,
  reason: string,
  refType: string | undefined,
  refId: string | undefined,
  tx: TransactionClient,
): Promise<number> {
  const updated = await tx.wallet.upsert({
    where: { userId },
    update: { balancePaisa: { increment: amountPaisa } },
    create: { userId, balancePaisa: amountPaisa },
  });
  await tx.walletTransaction.create({
    data: {
      userId,
      direction: "CREDIT",
      amountPaisa,
      reason,
      balanceAfterPaisa: updated.balancePaisa,
      refType,
      refId,
    },
  });
  return updated.balancePaisa;
}

export async function debitWallet(
  userId: string,
  amountPaisa: number,
  reason: string,
  refType: string | undefined,
  refId: string | undefined,
  tx: TransactionClient,
): Promise<number> {
  const updated = await tx.wallet.upsert({
    where: { userId },
    update: { balancePaisa: { decrement: amountPaisa } },
    create: { userId, balancePaisa: -amountPaisa },
  });
  await tx.walletTransaction.create({
    data: {
      userId,
      direction: "DEBIT",
      amountPaisa,
      reason,
      balanceAfterPaisa: updated.balancePaisa,
      refType,
      refId,
    },
  });
  return updated.balancePaisa;
}

// ---------------------------------------------------------------------------
// Wallet summary (month in/out + pending holds + membership)
// ---------------------------------------------------------------------------

export async function getWalletSummary(userId: string) {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [credits, debits, pendingWithdrawals, membership] = await Promise.all([
    prisma.walletTransaction.aggregate({
      where: { userId, direction: "CREDIT", createdAt: { gte: startOfMonth } },
      _sum: { amountPaisa: true },
    }),
    prisma.walletTransaction.aggregate({
      where: { userId, direction: "DEBIT", createdAt: { gte: startOfMonth } },
      _sum: { amountPaisa: true },
    }),
    prisma.withdrawal.aggregate({
      where: { userId, status: { in: ["PENDING", "APPROVED"] } },
      _sum: { amountPaisa: true },
    }),
    getActiveMembership(userId),
  ]);

  return {
    monthCreditsPaisa: credits._sum.amountPaisa ?? 0,
    monthDebitsPaisa: debits._sum.amountPaisa ?? 0,
    pendingWithdrawalsPaisa: pendingWithdrawals._sum.amountPaisa ?? 0,
    membership,
  };
}

// ---------------------------------------------------------------------------
// Withdrawals — hold-based balance check
// ---------------------------------------------------------------------------

export async function requestWithdrawal(input: {
  userId: string;
  amountPaisa: number;
  channel: string;
}) {
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user) throw notFound("User");
  if (!user.phoneVerified && isProd) throw phoneNotVerified();

  const withdrawal = await prisma.$transaction(
    async (tx: TransactionClient) => {
      const wallet = await tx.wallet.upsert({
        where: { userId: input.userId },
        update: {},
        create: { userId: input.userId },
      });
      const pending = await tx.withdrawal.aggregate({
        where: { userId: input.userId, status: { in: ["PENDING", "APPROVED"] } },
        _sum: { amountPaisa: true },
      });
      const available = wallet.balancePaisa - (pending._sum.amountPaisa ?? 0);
      if (input.amountPaisa > available) {
        throw unprocessable("Insufficient available balance (pending withdrawals are held)");
      }
      return tx.withdrawal.create({
        data: {
          refNo: refNo("WDL"),
          userId: input.userId,
          amountPaisa: input.amountPaisa,
          channel: input.channel,
          destination: maskDestination(user.phone),
        },
      });
    },
    { timeout: 15000, maxWait: 8000 },
  );

  await audit({
    actorId: input.userId,
    action: "WITHDRAWAL_REQUESTED",
    entityType: "Withdrawal",
    entityId: withdrawal.id,
    meta: { amountPaisa: input.amountPaisa },
  });

  return withdrawal;
}

export async function listWithdrawals(userId: string) {
  return prisma.withdrawal.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}
