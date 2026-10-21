import { logger } from "../../lib/logger.js";
import { prisma } from "../../lib/prisma.js";
import { getStorageProvider } from "./index.js";

/**
 * Retryable upload purges.
 *
 * Account deletion and failed-intake cleanup purge stored uploads best-effort:
 * the primary operation must not fail because storage is unreachable. Before
 * this queue existed, a failed purge was only a log line — deletion reported
 * success while the bytes survived, and nothing ever tried again (the audit
 * flagged the honesty gap). Now every failure lands here, the deletion
 * response says how many purges are still pending, and
 * `scripts/purge-uploads.ts` (runbook: failed-transaction-recovery) drains the
 * queue with idempotent provider deletes.
 */
export async function enqueuePendingPurge(key: string, context: string, error: string): Promise<void> {
  try {
    await prisma.pendingUploadPurge.create({
      data: { key, context, lastError: error.slice(0, 300), attempts: 1 },
    });
  } catch (e) {
    // Enqueueing is itself best-effort; never break the caller's flow.
    logger.warn({ key, context, err: (e as Error).message }, "could not enqueue pending upload purge");
  }
}

export async function drainPendingPurges(limit = 50): Promise<{ drained: number; failed: number; remaining: number }> {
  const rows = await prisma.pendingUploadPurge.findMany({ orderBy: { createdAt: "asc" }, take: limit });
  let drained = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await getStorageProvider().delete(row.key);
      await prisma.pendingUploadPurge.delete({ where: { id: row.id } });
      drained++;
    } catch (e) {
      failed++;
      try {
        await prisma.pendingUploadPurge.update({
          where: { id: row.id },
          data: { attempts: { increment: 1 }, lastError: (e as Error).message.slice(0, 300) },
        });
      } catch {
        // If even the bookkeeping update fails, the row stays for the next run.
      }
    }
  }
  const remaining = await prisma.pendingUploadPurge.count();
  return { drained, failed, remaining };
}
