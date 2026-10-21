import { describe, expect, it, vi } from "vitest";
import { prisma } from "../src/lib/prisma.js";
import { DEMO_PHONES, runSeed, seedPlan } from "../prisma/seed.js";

/**
 * API-06: the seed is two layers. Reference data (membership plans, product
 * and service catalogue) is environment-neutral and always allowed; demo data
 * (users with the public password Demo@1234, wallets, farm, demo providers)
 * refuses production unless BOTH ALLOW_DEMO_SEED=1 and
 * ALLOW_DEMO_CREDENTIALS_IN_PRODUCTION=1 are set — and then warns loudly,
 * listing every demo phone. `seedPlan` is the pure decision; `runSeed` applies
 * it, so both are driven here directly.
 */
describe("seed separation (API-06)", () => {
  it("reference data is always allowed; demo data needs both opt-ins in production", () => {
    expect(seedPlan({ NODE_ENV: "test" })).toEqual({ reference: true, demo: true });
    expect(seedPlan({ NODE_ENV: "development" })).toEqual({ reference: true, demo: true });
    expect(seedPlan({ NODE_ENV: "production" })).toEqual({ reference: true, demo: false });
    // One flag alone is never enough.
    expect(seedPlan({ NODE_ENV: "production", ALLOW_DEMO_SEED: "1" })).toEqual({ reference: true, demo: false });
    expect(seedPlan({ NODE_ENV: "production", ALLOW_DEMO_CREDENTIALS_IN_PRODUCTION: "1" })).toEqual({ reference: true, demo: false });
    expect(
      seedPlan({ NODE_ENV: "production", ALLOW_DEMO_SEED: "1", ALLOW_DEMO_CREDENTIALS_IN_PRODUCTION: "1" }),
    ).toEqual({ reference: true, demo: true });
  });

  it("in test mode both parts run, and the demo wallet carries its matching ledger row", async () => {
    const log = vi.fn();
    const warn = vi.fn();
    const report = await runSeed(prisma, { NODE_ENV: "test" }, log, warn);

    expect(report.plan).toEqual({ reference: true, demo: true });
    expect(report.demoPhones).toEqual(DEMO_PHONES);
    expect(warn).not.toHaveBeenCalled();

    // Reference catalogue is present.
    expect(await prisma.membershipPlan.count()).toBeGreaterThan(0);
    expect(await prisma.product.count()).toBeGreaterThan(0);
    expect(await prisma.service.count()).toBeGreaterThan(0);

    // Demo identity exists and its wallet reconciles (balance == CREDIT − DEBIT).
    const farmer = await prisma.user.findUniqueOrThrow({ where: { phone: "01700000002" } });
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId: farmer.id } });
    const credits = await prisma.walletTransaction.aggregate({ where: { userId: farmer.id, direction: "CREDIT" }, _sum: { amountPaisa: true } });
    const debits = await prisma.walletTransaction.aggregate({ where: { userId: farmer.id, direction: "DEBIT" }, _sum: { amountPaisa: true } });
    expect(wallet.balancePaisa).toBe((credits._sum.amountPaisa ?? 0) - (debits._sum.amountPaisa ?? 0));

    expect(log.mock.calls.flat().join("\n")).toContain("Seed complete");
  });

  it("production without both flags seeds reference data, skips demo identities and stays silent", async () => {
    const log = vi.fn();
    const warn = vi.fn();
    const report = await runSeed(prisma, { NODE_ENV: "production" }, log, warn);

    expect(report.plan).toEqual({ reference: true, demo: false });
    expect(report.demoPhones).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join("\n")).toContain("demo data skipped");
    expect(await prisma.membershipPlan.count()).toBeGreaterThan(0);
  });

  it("forced in production, it warns loudly and lists every demo phone", async () => {
    const log = vi.fn();
    const warn = vi.fn();
    const report = await runSeed(
      prisma,
      { NODE_ENV: "production", ALLOW_DEMO_SEED: "1", ALLOW_DEMO_CREDENTIALS_IN_PRODUCTION: "1" },
      log,
      warn,
    );

    expect(report.demoPhones).toEqual(DEMO_PHONES);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = warn.mock.calls[0]?.[0] as string;
    expect(message).toContain("PRODUCTION");
    for (const phone of DEMO_PHONES) expect(message).toContain(phone);
  });
});
