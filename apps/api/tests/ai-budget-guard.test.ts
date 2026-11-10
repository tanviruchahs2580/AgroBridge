import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { dhakaMonthStart } from "../src/shared/utils/dhakaMonth.js";

/**
 * F-22 — the monthly AI budget guard, exercised end to end (non-production).
 *
 * The audit found the guard had never been tested at all, plus three real
 * defects: a provider that omits `usage` spent money that was never metered, a
 * failed telemetry write erased spend silently, and the check-then-act sequence
 * let concurrent requests all pass a pre-call budget check. This suite pins the
 * hardening:
 *
 *  - a hosted call is admitted through a worst-case reservation row, then
 *    settled with its real (or estimated) figures;
 *  - two concurrent requests cannot both be admitted across the budget line;
 *  - a provider that omits `usage` still lands in the ledger with a non-zero
 *    cost (estimated, never zero);
 *  - over budget, non-production falls back to the offline engine and the
 *    metric label matches the engine's own name (the label split is gone).
 *
 * Production semantics (429 / 503, never a silent fallback) are pinned in
 * ai-budget-guard-prod.test.ts; the two files need different NODE_ENV values,
 * so they are separate files.
 */
process.env.AI_PROVIDER = "openai-compatible";
process.env.OPENAI_API_KEY = "test-key";
process.env.AI_COST_PER_1K_TOKENS_PAISA = "100";
process.env.AI_MONTHLY_BUDGET_PAISA = "500";
process.env.LOG_LEVEL = "silent";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

type Gateway = typeof import("../src/providers/ai/gateway.js");

let gateway: Gateway;
let prisma: typeof import("../src/lib/prisma.js")["prisma"];
let registry: typeof import("../src/infrastructure/metrics.js")["registry"];

beforeAll(async () => {
  gateway = await import("../src/providers/ai/gateway.js");
  ({ prisma } = await import("../src/lib/prisma.js"));
  ({ registry } = await import("../src/infrastructure/metrics.js"));
}, 120_000);

afterEach(() => {
  fetchMock.mockReset();
});

/**
 * This file's usage rows are deleted on the way out: the suite shares one
 * database, and a few hundred paisa of settled test spend left on the books
 * would consume the production file's 500-paisa budget and fail it for the
 * wrong reason.
 */
afterAll(async () => {
  await prisma.aiUsageLog.deleteMany({
    where: { requestId: { in: ["settle-1", "no-usage-1", "race-1", "race-2", "settle-fail-1"] } },
  });
});

function completion(content: string, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
      ...extra,
    }),
  } as Response;
}

async function metricValues(counterName: string): Promise<{ labels: Record<string, string>; value: number }[]> {
  const json = (await registry.getMetricsAsJSON()) as { name: string; values: { labels: Record<string, string>; value: number }[] }[];
  return json.find((m) => m.name === counterName)?.values ?? [];
}

async function usageRows(requestId: string) {
  return prisma.aiUsageLog.findMany({ where: { requestId }, orderBy: { createdAt: "asc" } });
}

describe("AI budget guard (non-production)", () => {
  it("reservation basis is deterministic and registered", () => {
    // 8 000 reserved prompt chars / 4 chars-per-token + 600 output tokens, at
    // 100 paisa per 1k tokens → 260 paisa; a 100-char question adds one paisa.
    expect(gateway.estimateTokensFromChars(4000)).toBe(1000);
    expect(gateway.worstCaseCostPaisa(0)).toBe(260);
    expect(gateway.worstCaseCostPaisa(100)).toBe(263);
  });

  it("admits a hosted call, settles the reservation, and records the served model", async () => {
    fetchMock.mockResolvedValueOnce(completion("Apply urea in 3 splits at tillering.", { model: "gpt-4o-mini-2024-07-18" }));
    const answer = await gateway.askAgroAgent("When should I apply urea to my rice field?", { lang: "en", requestId: "settle-1" });
    expect(answer.provider).toBe("openai-compatible");

    const rows = await usageRows("settle-1");
    expect(rows).toHaveLength(1); // one reservation, settled — no orphan rows
    expect(rows[0].success).toBe(true);
    expect(rows[0].model).toBe("gpt-4o-mini-2024-07-18");
    expect(rows[0].kbVersion).toBe(answer.kbVersion);
    // Actual usage (11 + 7 tokens) at 100 paisa/1k → ceil(1.8) = 2 paisa.
    expect(rows[0].costEstimatePaisa).toBe(2);
    expect(rows[0].tokensIn).toBe(11);
    expect(rows[0].tokensOut).toBe(7);
  });

  it("meters a hosted call whose provider omits `usage` (estimated, never zero)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "Apply urea in 3 splits at tillering." }, finish_reason: "stop" }] }),
    } as Response);
    const answer = await gateway.askAgroAgent("When should I apply urea to my rice field?", { lang: "en", requestId: "no-usage-1" });
    expect(answer.provider).toBe("openai-compatible");
    expect(answer.tokensIn).toBeUndefined();

    const rows = await usageRows("no-usage-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].costEstimatePaisa ?? 0).toBeGreaterThan(0);
    expect(rows[0].tokensIn ?? 0).toBeGreaterThan(0);
    expect(rows[0].tokensOut ?? 0).toBeGreaterThan(0);
  });

  it("two concurrent requests cannot both cross the budget line (reservation closes the race)", async () => {
    // Hold the provider open so both reservations coexist, exactly the window
    // in which the old check-then-act sequence admitted every request.
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async () => {
      await gate;
      return completion("Apply urea in 3 splits at tillering.");
    });

    const first = gateway.askAgroAgent("When should I apply urea to my rice field?", { lang: "en", requestId: "race-1" });
    const second = gateway.askAgroAgent("When should I apply urea to my rice field?", { lang: "en", requestId: "race-2" });
    // Let both admissions run while the provider hangs.
    await new Promise((r) => setTimeout(r, 50));
    release();
    const [a, b] = await Promise.all([first, second]);

    const hosted = [a, b].filter((x) => x.provider === "openai-compatible").length;
    const offline = [a, b].filter((x) => x.provider === "offline-agro-engine").length;
    expect(hosted + offline).toBe(2);
    // Two 260-paisa reservations cannot both fit under the 500-paisa cap. The
    // old code (pre-call sum check only) admitted BOTH and wrote the cost after
    // the call, so this assertion fails on the un-hardened guard. Depending on
    // interleaving the first request may itself be refused because it sees the
    // second's reservation: the guard is allowed to trip early (fail closed),
    // never late.
    expect(hosted).toBeLessThanOrEqual(1);
    expect(offline).toBeGreaterThanOrEqual(1);

    // The refused request's reservation is released, not left on the books.
    for (const requestId of ["race-1", "race-2"]) {
      const rows = await usageRows(requestId);
      expect(rows.filter((r) => !r.success)).toHaveLength(0);
    }
    // The fallback metric carries the engine's own name — the old
    // `offline-engine` label split is gone.
    const values = await metricValues("agrobridge_ai_requests_total");
    expect(values.some((v) => v.labels.provider === "offline-agro-engine" && v.labels.status === "budget_fallback")).toBe(true);
  });

  it("over budget, non-production falls back to the offline engine and never calls the provider", async () => {
    await prisma.aiUsageLog.create({
      data: { provider: "openai-compatible", model: "gpt-4o-mini", latencyMs: 5, success: true, costEstimatePaisa: 500 },
    });
    const answer = await gateway.askAgroAgent("When should I apply urea to my rice field?", { lang: "en", requestId: "over-1" });
    expect(answer.provider).toBe("offline-agro-engine");
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await usageRows("over-1")).filter((r) => !r.success)).toHaveLength(0);
    // Clean up the seeded spend so it cannot bleed into another test in the file.
    await prisma.aiUsageLog.deleteMany({ where: { requestId: null, provider: "openai-compatible", costEstimatePaisa: 500 } });
  });

  it("counts only the current Dhaka month — the window is the business calendar, not the server clock", async () => {
    // F-22: the month boundary is Asia/Dhaka (users and ops read ৳ figures in
    // Dhaka time). The window had no test at all, so a regression back to the
    // server-local month — which moves every record made 00:00–06:00 Dhaka into
    // the wrong month on a UTC host — would have gone unnoticed.
    const now = new Date();
    const start = dhakaMonthStart(now);
    const marker = 4321; // unique to this test, so cleanup cannot touch other rows
    const baseline = await gateway.monthlySpendPaisa(now);
    try {
      // Last instant of the PREVIOUS Dhaka month: must not consume this month's budget.
      await prisma.aiUsageLog.create({
        data: { provider: "openai-compatible", model: "gpt-4o-mini", latencyMs: 0, success: true, costEstimatePaisa: marker, createdAt: new Date(start.getTime() - 1) },
      });
      expect(await gateway.monthlySpendPaisa(now)).toBe(baseline);

      // First instant of THIS Dhaka month: counted (`gte` is inclusive).
      await prisma.aiUsageLog.create({
        data: { provider: "openai-compatible", model: "gpt-4o-mini", latencyMs: 0, success: true, costEstimatePaisa: marker, createdAt: new Date(start.getTime()) },
      });
      expect(await gateway.monthlySpendPaisa(now)).toBe(baseline + marker);

      // Only hosted-provider rows count: the free offline engine's rows can
      // never trip — or relieve — the hosted spend breaker.
      await prisma.aiUsageLog.create({
        data: { provider: "offline-agro-engine", model: "kb-retrieval-v1", latencyMs: 0, success: true, costEstimatePaisa: marker, createdAt: new Date(start.getTime() + 1) },
      });
      expect(await gateway.monthlySpendPaisa(now)).toBe(baseline + marker);
    } finally {
      await prisma.aiUsageLog.deleteMany({ where: { costEstimatePaisa: marker } });
    }
  });

  it("a failed usage settlement never fails the request and keeps the reservation on the books", async () => {
    fetchMock.mockResolvedValueOnce(completion("Apply urea in 3 splits at tillering."));
    const updateSpy = vi.spyOn(prisma.aiUsageLog, "update").mockRejectedValueOnce(new Error("usage write down"));
    try {
      const answer = await gateway.askAgroAgent("When should I apply urea to my rice field?", { lang: "en", requestId: "settle-fail-1" });
      // The old code swallowed the failure with a bare catch and wrote nothing;
      // the request must still succeed (telemetry is not a user-facing path)…
      expect(answer.provider).toBe("openai-compatible");
    } finally {
      updateSpy.mockRestore();
    }
    // …but the worst-case reservation survives with a non-zero cost, so a
    // telemetry outage can never silently erase spend from the monthly sum.
    const rows = await usageRows("settle-fail-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].success).toBe(false);
    expect(rows[0].costEstimatePaisa ?? 0).toBeGreaterThan(0);
    await prisma.aiUsageLog.deleteMany({ where: { requestId: "settle-fail-1" } });
  });
});
