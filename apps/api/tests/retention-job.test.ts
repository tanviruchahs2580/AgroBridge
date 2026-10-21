import { afterAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "../src/lib/prisma.js";
import { registerFarmer } from "./helpers.js";
// @ts-expect-error -- plain-JS production script (scripts/retention.mjs has no type
// declarations); its exported shape is pinned by the assertions below.
import { RETENTION_POLICY, runRetention } from "../scripts/retention.mjs";

/**
 * SEC-06 / ADR-0011: the retention job deletes ONLY rows past their documented
 * window. Rows inside the window — including one expired token that is still
 * within 30 days — must survive. The purge-queue drain is injected so the test
 * observes the ordering contract (drain first, delete after) without spawning
 * the tsx subprocess the CLI uses.
 */
const day = (n: number) => new Date(Date.now() - n * 24 * 3600 * 1000);
const hoursAgo = (n: number) => new Date(Date.now() - n * 3600 * 1000);

let seed = "";

describe("retention job (SEC-06)", () => {
  afterAll(async () => {
    // Keep the shared test DB tidy: drop only the rows this file created.
    await prisma.refreshToken.deleteMany({ where: { tokenHash: { startsWith: `retention-${seed}` } } });
    await prisma.otpChallenge.deleteMany({ where: { codeHash: { startsWith: `retention-${seed}` } } });
    await prisma.auditLog.deleteMany({ where: { action: { startsWith: `RETENTION_TEST_${seed}` } } });
    await prisma.pendingUploadPurge.deleteMany({ where: { key: { startsWith: `retention-${seed}` } } });
  });

  it("deletes only rows past the policy window, drain first, and leaves fresh rows untouched", async () => {
    seed = randomBytes(4).toString("hex");
    const f = await registerFarmer();

    const marker = `retention-${seed}`;

    // --- refresh tokens -------------------------------------------------
    const oldExpired = await prisma.refreshToken.create({
      data: { userId: f.user.id, tokenHash: `${marker}-old-expired`, expiresAt: day(31), createdAt: day(31) },
    });
    const oldRevoked = await prisma.refreshToken.create({
      data: { userId: f.user.id, tokenHash: `${marker}-old-revoked`, expiresAt: day(1), revokedAt: day(31), createdAt: day(40) },
    });
    const freshExpired = await prisma.refreshToken.create({
      data: { userId: f.user.id, tokenHash: `${marker}-fresh-expired`, expiresAt: day(1), createdAt: day(8) },
    });
    const fresh = await prisma.refreshToken.create({
      data: { userId: f.user.id, tokenHash: `${marker}-fresh`, expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) },
    });

    // --- OTP challenges -------------------------------------------------
    const oldConsumed = await prisma.otpChallenge.create({
      data: { userId: f.user.id, phone: f.phone, codeHash: `${marker}-old-consumed`, consumedAt: hoursAgo(25), expiresAt: hoursAgo(26), createdAt: hoursAgo(26) },
    });
    const oldExpiredOtp = await prisma.otpChallenge.create({
      data: { userId: f.user.id, phone: f.phone, codeHash: `${marker}-old-expired`, expiresAt: hoursAgo(25), createdAt: hoursAgo(25) },
    });
    const freshExpiredOtp = await prisma.otpChallenge.create({
      data: { userId: f.user.id, phone: f.phone, codeHash: `${marker}-fresh-expired`, expiresAt: hoursAgo(1), createdAt: hoursAgo(5) },
    });

    // --- audit log ------------------------------------------------------
    const oldAudit = await prisma.auditLog.create({
      data: { actorId: f.user.id, action: `RETENTION_TEST_${seed}_OLD`, createdAt: day(181) },
    });
    const freshAudit = await prisma.auditLog.create({
      data: { actorId: f.user.id, action: `RETENTION_TEST_${seed}_FRESH`, createdAt: day(179) },
    });

    // --- pending upload purges ------------------------------------------
    const oldPurge = await prisma.pendingUploadPurge.create({
      data: { key: `${marker}-old-key`, context: "retention test", attempts: 9, lastError: "storage unreachable", createdAt: day(31) },
    });
    const freshPurge = await prisma.pendingUploadPurge.create({
      data: { key: `${marker}-fresh-key`, context: "retention test", attempts: 1, createdAt: day(29) },
    });

    // The injected drain must run while the old row still exists (drain first,
    // delete after) and reports success.
    let oldRowVisibleAtDrainTime: unknown = "drain-never-called";
    const drain = vi.fn(async () => {
      oldRowVisibleAtDrainTime = await prisma.pendingUploadPurge.findUnique({ where: { id: oldPurge.id } });
      return true;
    });

    const result = (await runRetention(prisma, { drain, log: () => {} })) as {
      refreshTokens: number;
      otpChallenges: number;
      auditLogs: number;
      pendingPurges: number;
      drained: boolean;
    };

    expect(result.drained).toBe(true);
    expect(drain).toHaveBeenCalledTimes(1);
    expect(oldRowVisibleAtDrainTime).not.toBeNull();
    expect(result.refreshTokens).toBe(2); // old-expired + old-revoked
    expect(result.otpChallenges).toBe(2); // old-consumed + old-expired
    expect(result.auditLogs).toBe(1); // 181-day-old row only
    expect(result.pendingPurges).toBe(1); // 31-day-old row only

    // Old rows are gone…
    expect(await prisma.refreshToken.findUnique({ where: { id: oldExpired.id } })).toBeNull();
    expect(await prisma.refreshToken.findUnique({ where: { id: oldRevoked.id } })).toBeNull();
    expect(await prisma.otpChallenge.findUnique({ where: { id: oldConsumed.id } })).toBeNull();
    expect(await prisma.otpChallenge.findUnique({ where: { id: oldExpiredOtp.id } })).toBeNull();
    expect(await prisma.auditLog.findUnique({ where: { id: oldAudit.id } })).toBeNull();
    expect(await prisma.pendingUploadPurge.findUnique({ where: { id: oldPurge.id } })).toBeNull();

    // …and every row inside the window survives.
    expect(await prisma.refreshToken.findUnique({ where: { id: freshExpired.id } })).not.toBeNull();
    expect(await prisma.refreshToken.findUnique({ where: { id: fresh.id } })).not.toBeNull();
    expect(await prisma.otpChallenge.findUnique({ where: { id: freshExpiredOtp.id } })).not.toBeNull();
    expect(await prisma.auditLog.findUnique({ where: { id: freshAudit.id } })).not.toBeNull();
    expect(await prisma.pendingUploadPurge.findUnique({ where: { id: freshPurge.id } })).not.toBeNull();
  });

  it("states the policy numbers the job implements", () => {
    expect(RETENTION_POLICY).toEqual({
      refreshTokensDays: 30,
      otpChallengesHours: 24,
      auditLogDays: 180,
      pendingPurgesDays: 30,
    });
  });
});
