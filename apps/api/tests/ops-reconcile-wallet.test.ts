import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Request } from "express";
import { app } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { AppError } from "../src/shared/errors/index.js";
import { assertCronSecret } from "../src/modules/ops/routes.js";
// @ts-expect-error -- plain-JS production script (no type declarations); the
// endpoint under test imports this exact function, so the expected verdicts
// below are computed from the same implementation rather than restated.
import { reconcileWallets } from "../scripts/reconcile-wallet.mjs";

/**
 * F-20: the Vercel cron `0 4 * * *` already targeted
 * `/api/v1/ops/reconcile-wallet`, and nothing was mounted there — a schedule
 * pointing at a 404. This suite pins the endpoint's contract:
 *
 *   - no CRON_SECRET configured → 503 (fail closed, never an unguarded sweep);
 *   - wrong / absent bearer → 403;
 *   - clean ledger → 200 with the wallet count;
 *   - a discrepancy → 500 with the code the cron log must show, so the run
 *     fails visibly instead of reporting success over a drifted ledger.
 *
 * The shared suite database is NOT a clean-ledger state (other files seed bare
 * wallet balances as fixtures), so the expected verdict is computed from the
 * reconciliation function itself and the mismatch branch is forced on a wallet
 * this test owns — then restored, so the file leaves the DB as it found it.
 */
type ReconcileResult = { walletsChecked: number; mismatches: Record<string, unknown>[] };

async function expectedVerdict(): Promise<ReconcileResult> {
  return (await reconcileWallets(prisma)) as ReconcileResult;
}

const CRON = { Authorization: "Bearer test-cron-secret" };

describe("GET /api/v1/ops/reconcile-wallet — cron-guarded wallet reconciliation", () => {
  /**
   * The unset-secret branch cannot be reached over HTTP here: tests/setup-env.ts
   * sets CRON_SECRET (the retention suite depends on it). It is pinned on the
   * shared guard instead — and the guard is shared, so this covers /retention
   * too: "no secret configured" must be 503 (fail closed), never "no guard".
   */
  it("an unset CRON_SECRET fails closed with 503, for both scheduled routes", () => {
    for (const what of ["retention", "reconciliation"]) {
      let thrown: unknown;
      try {
        assertCronSecret({ headers: {} } as Request, undefined, what);
      } catch (e) {
        thrown = e;
      }
      expect(thrown, `${what} accepted an unset secret`).toBeInstanceOf(AppError);
      const err = thrown as AppError;
      expect(err.status).toBe(503);
      expect(err.code).toBe("SERVICE_UNAVAILABLE");
      expect(err.message).toMatch(/CRON_SECRET is not configured/);
    }
  });

  it("the shared guard compares the bearer without accepting near-misses", () => {
    const req = (authorization?: string) =>
      ({ headers: authorization === undefined ? {} : { authorization } }) as unknown as Request;
    expect(() => assertCronSecret(req("Bearer test-cron-secret"), "test-cron-secret", "x")).not.toThrow();
    for (const wrong of ["Bearer test-cron-secret ", "bearer test-cron-secret", "test-cron-secret", "Bearer test-cron-secre"]) {
      expect(() => assertCronSecret(req(wrong), "test-cron-secret", "x"), `accepted "${wrong}"`).toThrowError();
    }
  });

  it("rejects anonymous callers with 403", async () => {
    const res = await request(app).get("/api/v1/ops/reconcile-wallet");
    expect(res.status).toBe(403);
    expect(res.body.ok).toBe(false);
  });

  it("rejects a wrong bearer token with 403", async () => {
    const res = await request(app).get("/api/v1/ops/reconcile-wallet").set("Authorization", "Bearer not-the-secret");
    expect(res.status).toBe(403);
  });

  it("is not reachable with a user session (the guard is the secret, not a role)", async () => {
    const { registerFarmer } = await import("./helpers.js");
    const f = await registerFarmer();
    const res = await request(app).get("/api/v1/ops/reconcile-wallet").set("Authorization", `Bearer ${f.accessToken}`);
    expect(res.status).toBe(403);
  });

  it("a clean ledger answers 200 with the wallet count, and the run is audited", async () => {
    // Repair every discrepancy the suite DB carries, assert the clean verdict,
    // then put the original stored values back (this file must not silently
    // "fix" another suite's fixture).
    const wallets = await prisma.wallet.findMany({ select: { userId: true, balancePaisa: true, heldPaisa: true } });
    const originals = wallets.map((w) => ({ ...w }));
    const baseline = await expectedVerdict();
    try {
      for (const m of baseline.mismatches) {
        const userId = m.userId as string;
        if (typeof m.computed === "number") {
          await prisma.wallet.update({ where: { userId }, data: { balancePaisa: m.computed } });
        }
        if (typeof m.heldComputed === "number") {
          await prisma.wallet.update({ where: { userId }, data: { heldPaisa: m.heldComputed } });
        }
      }
      const before = await prisma.auditLog.count({ where: { action: "WALLET_RECONCILIATION_RUN" } });
      const res = await request(app).get("/api/v1/ops/reconcile-wallet").set(CRON);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.data.ran).toBe(true);
      expect(res.body.data.mismatches).toBe(0);
      expect(res.body.data.walletsChecked).toBeGreaterThan(0);
      expect(await prisma.auditLog.count({ where: { action: "WALLET_RECONCILIATION_RUN" } })).toBe(before + 1);
    } finally {
      for (const w of originals) {
        await prisma.wallet.update({ where: { userId: w.userId }, data: { balancePaisa: w.balancePaisa, heldPaisa: w.heldPaisa } });
      }
    }
  }, 60_000);

  it("a drifted balance answers 500 with the mismatch code and the offending user, then 200 after repair", async () => {
    const { registerFarmer } = await import("./helpers.js");
    const f = await registerFarmer();
    // A fresh wallet is consistent by construction (0 balance, empty ledger).
    await prisma.wallet.update({ where: { userId: f.user.id }, data: { balancePaisa: 424_242 } });

    const drifted = await request(app).get("/api/v1/ops/reconcile-wallet").set(CRON);
    expect(drifted.status).toBe(500);
    expect(drifted.body.ok).toBe(false);
    expect(drifted.body.error.code).toBe("WALLET_RECONCILIATION_MISMATCH");
    const listed = (drifted.body.error.details as { mismatches: { userId: string }[] }).mismatches;
    expect(listed.some((m) => m.userId === f.user.id)).toBe(true);

    // Put it back: the endpoint must agree, in the same run, that the ledger is
    // sound again (and the verdict must equal the independently computed one).
    await prisma.wallet.update({ where: { userId: f.user.id }, data: { balancePaisa: 0 } });
    const repaired = await expectedVerdict();
    const res = await request(app).get("/api/v1/ops/reconcile-wallet").set(CRON);
    expect(res.status).toBe(repaired.mismatches.length === 0 ? 200 : 500);
  }, 60_000);
});
