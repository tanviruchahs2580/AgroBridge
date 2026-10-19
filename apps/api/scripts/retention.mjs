#!/usr/bin/env node
/**
 * Data-retention enforcement (SEC-06 / ADR-0011). Policy — stated here and in
 * docs/data-protection.md:
 *   - expired or revoked refresh tokens older than 30 days;
 *   - consumed or expired OTP challenges older than 24 hours (dead auth
 *     secrets have no retention value);
 *   - AuditLog rows older than 180 days (security-trail retention window);
 *   - PendingUploadPurge rows older than 30 days — but only AFTER one final
 *     drain attempt through the existing purge job, so the last failure reason
 *     is retried before the row is dropped (otherwise a permanently failing
 *     key would pin the row forever).
 * Run via cron: 0 5 * * * cd /srv/agrobridge/apps/api && npm run retention
 * Exits 1 when a delete or the final drain fails, 0 otherwise. Safe to re-run.
 *
 * `runRetention` is exported so tests/retention-job.test.ts drives this exact
 * code against seeded old/fresh rows; importing the module connects nothing.
 */
import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";

export const RETENTION_POLICY = {
  refreshTokensDays: 30,
  otpChallengesHours: 24,
  auditLogDays: 180,
  pendingPurgesDays: 30,
};

const DAY_MS = 24 * 3600 * 1000;

/**
 * Final drain wired into the CLI. The purge queue lives in TypeScript
 * (src/providers/storage/purgeQueue.ts) and a plain-node script cannot import
 * it, so the existing purge job is run through tsx — the same delegation the
 * deploy provisioning script uses. A failed drain is logged and reported, not
 * thrown: the old purge rows are still deleted afterwards by policy.
 */
function drainPendingPurgesViaCli(log) {
  try {
    // execSync (not execFileSync): Windows resolves `npx` through cmd, the
    // same shell delegation scripts/provision-postgres.mjs uses.
    const out = execSync("npx tsx scripts/purge-uploads.ts", { encoding: "utf8" });
    if (out.trim()) log(out.trim());
    return true;
  } catch (e) {
    log(`retention: final purge drain failed — old pending rows are deleted anyway: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}

/**
 * Applies the retention policy.
 *
 * @param {import("@prisma/client").PrismaClient} client
 * @param {{ now?: Date; drain?: (log: (m: string) => void) => boolean | Promise<boolean>; log?: (m: string) => void }} [opts]
 * @returns {Promise<{ refreshTokens: number; otpChallenges: number; auditLogs: number; pendingPurges: number; drained: boolean }>}
 */
export async function runRetention(client, { now = new Date(), drain = drainPendingPurgesViaCli, log = console.log } = {}) {
  const cutoff = (ms) => new Date(now.getTime() - ms);

  const refreshTokens = await client.refreshToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: cutoff(RETENTION_POLICY.refreshTokensDays * DAY_MS) } },
        { revokedAt: { lt: cutoff(RETENTION_POLICY.refreshTokensDays * DAY_MS) } },
      ],
    },
  });

  const otpChallenges = await client.otpChallenge.deleteMany({
    where: {
      OR: [
        { consumedAt: { lt: cutoff(RETENTION_POLICY.otpChallengesHours * 3600 * 1000) } },
        { expiresAt: { lt: cutoff(RETENTION_POLICY.otpChallengesHours * 3600 * 1000) } },
      ],
    },
  });

  const auditLogs = await client.auditLog.deleteMany({
    where: { createdAt: { lt: cutoff(RETENTION_POLICY.auditLogDays * DAY_MS) } },
  });

  // Drain before the purge-row delete: the attempt must see the old rows.
  const drained = (await drain(log)) === true;
  const pendingPurges = await client.pendingUploadPurge.deleteMany({
    where: { createdAt: { lt: cutoff(RETENTION_POLICY.pendingPurgesDays * DAY_MS) } },
  });

  return {
    refreshTokens: refreshTokens.count,
    otpChallenges: otpChallenges.count,
    auditLogs: auditLogs.count,
    pendingPurges: pendingPurges.count,
    drained,
  };
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const prisma = new PrismaClient();
  try {
    const result = await runRetention(prisma);
    console.log(
      `retention: refreshTokens=${result.refreshTokens} otpChallenges=${result.otpChallenges} ` +
        `auditLogs=${result.auditLogs} pendingPurges=${result.pendingPurges} drained=${result.drained}`,
    );
    if (!result.drained) process.exitCode = 1;
  } catch (e) {
    console.error("retention failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
