import type { PrismaClient } from "@prisma/client";
import { drainPendingPurges } from "../providers/storage/purgeQueue.js";

/**
 * Data-retention enforcement (SEC-06 / ADR-0011) — the single source of truth
 * for the policy and its executor. Two callers share this module:
 *   - `npm run retention` (scripts/retention.mjs, manual/CI), and
 *   `GET /api/v1/ops/retention` (the Vercel cron that runs it in production —
 *   apps/api/vercel.json `crons`), so the scheduled and manual paths can never
 *   drift apart.
 *
 * Policy — stated here and in docs/data-protection.md:
 *   - expired or revoked refresh tokens older than 30 days;
 *   - consumed or expired OTP challenges older than 24 hours (dead auth
 *     secrets have no retention value);
 *   - AuditLog rows older than 180 days (security-trail retention window);
 *   - PendingUploadPurge rows older than 30 days — but only AFTER one final
 *     drain attempt, so the last failure reason is retried before the row is
 *     dropped (otherwise a permanently failing key would pin the row forever);
 *   - AnalyticsEvent / Notification / AiUsageLog / AdvisoryQuery rows older
 *     than 180 days — these four previously sat outside every retention
 *     window and grew without bound (AUD-V3).
 */
export const RETENTION_POLICY = {
  refreshTokensDays: 30,
  otpChallengesHours: 24,
  auditLogDays: 180,
  pendingPurgesDays: 30,
  analyticsEventsDays: 180,
  notificationsDays: 180,
  aiUsageLogsDays: 180,
  advisoryQueriesDays: 180,
} as const;

const DAY_MS = 24 * 3600 * 1000;

/**
 * Default drain runs the retryable upload-purge queue directly (the same
 * drainPendingPurges the purge job uses). Returns false when rows failed, so
 * the caller reports a non-clean run instead of pretending success.
 */
async function defaultDrain(log: (m: string) => void): Promise<boolean> {
  const result = await drainPendingPurges(200);
  if (result.drained > 0 || result.failed > 0) {
    log(`retention: purge drain drained=${result.drained} failed=${result.failed} remaining=${result.remaining}`);
  }
  return result.failed === 0;
}

/**
 * Applies the retention policy. Safe to re-run; every window is idempotent.
 *
 * @param client Prisma client (the shared instance in-process; a fresh one in the CLI).
 * @param opts.now Clock injection for tests.
 * @param opts.drain Drain injection for tests (and for callers that must not
 *   shell out — the HTTP endpoint uses the programmatic default).
 */
export async function runRetention(
  client: PrismaClient,
  {
    now = new Date(),
    drain = defaultDrain,
    log = console.log,
  }: { now?: Date; drain?: (log: (m: string) => void) => boolean | Promise<boolean>; log?: (m: string) => void } = {}
): Promise<{
  refreshTokens: number;
  otpChallenges: number;
  auditLogs: number;
  pendingPurges: number;
  analyticsEvents: number;
  notifications: number;
  aiUsageLogs: number;
  advisoryQueries: number;
  drained: boolean;
}> {
  const cutoff = (ms: number) => new Date(now.getTime() - ms);

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

  const analyticsEvents = await client.analyticsEvent.deleteMany({
    where: { createdAt: { lt: cutoff(RETENTION_POLICY.analyticsEventsDays * DAY_MS) } },
  });
  const notifications = await client.notification.deleteMany({
    where: { createdAt: { lt: cutoff(RETENTION_POLICY.notificationsDays * DAY_MS) } },
  });
  const aiUsageLogs = await client.aiUsageLog.deleteMany({
    where: { createdAt: { lt: cutoff(RETENTION_POLICY.aiUsageLogsDays * DAY_MS) } },
  });
  const advisoryQueries = await client.advisoryQuery.deleteMany({
    where: { createdAt: { lt: cutoff(RETENTION_POLICY.advisoryQueriesDays * DAY_MS) } },
  });

  return {
    refreshTokens: refreshTokens.count,
    otpChallenges: otpChallenges.count,
    auditLogs: auditLogs.count,
    pendingPurges: pendingPurges.count,
    analyticsEvents: analyticsEvents.count,
    notifications: notifications.count,
    aiUsageLogs: aiUsageLogs.count,
    advisoryQueries: advisoryQueries.count,
    drained,
  };
}
