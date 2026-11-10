import { Router } from "express";
import type { Request } from "express";
import { timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";
import { prisma } from "../../lib/prisma.js";
import { ok } from "../../middleware/context.js";
import { forbidden, serviceUnavailable, walletReconciliationMismatch } from "../../shared/errors/index.js";
import { runRetention } from "../../shared/retention.js";
import { audit } from "../../middleware/audit.js";
import { logger } from "../../lib/logger.js";
// @ts-expect-error -- plain-JS production script with no type declarations (the
// same import tests/reconciliation.test.ts already makes). The specifier
// resolves to apps/api/scripts/reconcile-wallet.mjs from BOTH src/modules/ops/
// and the emitted dist/modules/ops/ (src and dist are siblings under apps/api),
// so the compiled function imports the same file @vercel/nft traces — one
// implementation of the check, not a copy that can drift.
import { reconcileWallets as reconcileWalletsScript } from "../../../scripts/reconcile-wallet.mjs";

/**
 * The script's exported shape, asserted once here so the call site below is
 * typed (the module has no declarations, so the raw symbol is `any`).
 */
const reconcileWallets = reconcileWalletsScript as unknown as (
  client: typeof prisma,
) => Promise<{ walletsChecked: number; mismatches: Record<string, unknown>[] }>;

/**
 * Scheduled-operations endpoints, invoked by the platform cron
 * (apps/api/vercel.json `crons`) — never by users. Vercel cron requests carry
 * `Authorization: Bearer $CRON_SECRET`; without the secret configured the
 * endpoints fail closed, because an unprotected retention trigger is a
 * data-deletion surface. Comparison is constant-time, like the webhook digest.
 */
export const opsRouter = Router();

/**
 * The cron guard every scheduled endpoint shares. One implementation, not a
 * copy per route: two copies of a security comparison is how one of them
 * later drifts (and the fail-closed branch is the one that matters most — an
 * unset secret must never mean "no guard", it means 503).
 *
 * Exported so the fail-closed branch is testable directly: the suite runs with
 * CRON_SECRET set, so the unset case cannot be reached over HTTP there.
 */
export function assertCronSecret(req: Request, secret: string | undefined, what: string): void {
  if (!secret) {
    throw serviceUnavailable(`Scheduled ${what} is disabled: CRON_SECRET is not configured`);
  }
  const provided = Buffer.from(req.headers.authorization ?? "", "utf8");
  const expected = Buffer.from(`Bearer ${secret}`, "utf8");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw forbidden("Scheduled operations require the cron secret");
  }
}

opsRouter.get("/retention", async (req, res, next) => {
  try {
    assertCronSecret(req, env.CRON_SECRET, "retention");

    const result = await runRetention(prisma, { log: (m) => logger.info(m) });
    logger.info({ result }, "ops: scheduled retention run complete");
    await audit({ action: "RETENTION_JOB_RUN", entityType: "System", entityId: "retention", meta: { ...result } });
    ok(res, { ran: true, ...result });
  } catch (e) {
    next(e);
  }
});

/**
 * Daily wallet reconciliation (F-20): the money-path check the Vercel cron
 * `0 4 * * *` in apps/api/vercel.json already targets — before this route the
 * schedule pointed at nothing, so a drifted ledger stayed invisible until a
 * user noticed. The check itself is NOT reimplemented here: it is the exported
 * `reconcileWallets` from scripts/reconcile-wallet.mjs (the same function
 * tests/reconciliation.test.ts exercises), so the manual CLI and the scheduled
 * run can never disagree about what "reconciled" means.
 *
 * A discrepancy answers 500, not 200: the cron invocation has to FAIL visibly
 * for the drift to be actionable. The response body (reached only with the
 * cron secret) carries EVERY mismatch, because the operator's job is to repair
 * all of them — a truncated list would leave the tail invisible and the run
 * failing forever (the first implementation sliced to 10 like the CLI's console
 * output, and a suite that leaks >10 drifted wallets pushed the real offender
 * out of the window). The CLI keeps its own 10-item console slice for noise; the
 * structured log here carries counts only, so no user id enters the shared log
 * pipeline.
 */
opsRouter.get("/reconcile-wallet", async (req, res, next) => {
  try {
    assertCronSecret(req, env.CRON_SECRET, "reconciliation");

    const { walletsChecked, mismatches } = await reconcileWallets(prisma);
    await audit({
      action: "WALLET_RECONCILIATION_RUN",
      entityType: "System",
      entityId: "reconcile-wallet",
      meta: { walletsChecked, mismatchCount: mismatches.length },
    });

    if (mismatches.length > 0) {
      logger.error(
        { walletsChecked, mismatchCount: mismatches.length, event: "wallet.reconciliation.mismatch" },
        "ops: wallet reconciliation found discrepancies",
      );
      throw walletReconciliationMismatch({ walletsChecked, mismatches });
    }

    logger.info({ walletsChecked, mismatchCount: 0 }, "ops: scheduled wallet reconciliation complete");
    ok(res, { ran: true, walletsChecked, mismatches: 0 });
  } catch (e) {
    next(e);
  }
});
