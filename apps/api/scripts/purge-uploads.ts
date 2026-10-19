/**
 * Drains the retryable upload-purge queue (PendingUploadPurge).
 *
 * Failed purges from account deletion or failed intake land here; this job
 * retries them with idempotent provider deletes. Safe to run repeatedly.
 *
 * Usage: npm run purge:uploads --workspace apps/api
 * Runbook: docs/runbooks/failed-transaction-recovery.md
 */
import { prisma } from "../src/lib/prisma.js";
import { drainPendingPurges } from "../src/providers/storage/purgeQueue.js";

async function main() {
  const before = await prisma.pendingUploadPurge.count();
  if (before === 0) {
    console.log("purge-uploads: queue empty");
    return;
  }
  const result = await drainPendingPurges(200);
  console.log(`purge-uploads: drained=${result.drained} failed=${result.failed} remaining=${result.remaining}`);
  if (result.failed > 0 || result.remaining > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("purge-uploads failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
