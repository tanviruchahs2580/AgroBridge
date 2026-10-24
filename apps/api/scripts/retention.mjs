#!/usr/bin/env node
/**
 * Data-retention CLI (SEC-06 / ADR-0011). The policy and its executor live in
 * src/shared/retention.ts — the single source of truth shared with the
 * production cron endpoint (GET /api/v1/ops/retention, wired as a Vercel cron
 * in apps/api/vercel.json) — so the scheduled and manual paths cannot drift.
 *
 * Run manually: npm run retention --workspace apps/api   (tsx resolves the TS import)
 * Production schedule: Vercel cron hits /api/v1/ops/retention daily at 20:43 UTC
 * (02:43 Dhaka — the lowest-traffic window for the user base).
 * Exits 1 when a delete or the final drain fails, 0 otherwise. Safe to re-run.
 */
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";
import { runRetention } from "../src/shared/retention.js";

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const prisma = new PrismaClient();
  try {
    const result = await runRetention(prisma);
    console.log(
      `retention: refreshTokens=${result.refreshTokens} otpChallenges=${result.otpChallenges} ` +
        `auditLogs=${result.auditLogs} pendingPurges=${result.pendingPurges} ` +
        `analyticsEvents=${result.analyticsEvents} notifications=${result.notifications} ` +
        `aiUsageLogs=${result.aiUsageLogs} advisoryQueries=${result.advisoryQueries} drained=${result.drained}`
    );
    if (!result.drained) process.exitCode = 1;
  } catch (e) {
    console.error("retention failed:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
