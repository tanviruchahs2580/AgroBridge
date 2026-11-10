import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * F-22 — the monthly AI budget guard, production semantics.
 *
 * In production the gateway must refuse rather than silently degrade:
 * over budget → 429 AI_BUDGET_EXCEEDED; unable to meter (the reservation write
 * fails) → 503 AI_METERING_UNAVAILABLE. The non-production fallback path is
 * covered in ai-budget-guard.test.ts; the two files cannot share one NODE_ENV,
 * hence the split.
 *
 * NODE_ENV=production makes the production env guards run: the placeholder
 * providers configured by tests/setup-env.ts must be explicitly accepted, and
 * the hosted provider needs a non-zero tariff so the spend breaker is not inert
 * (the same rule `hostedAiCostProblem` enforces at boot).
 */
process.env.NODE_ENV = "production";
process.env.ALLOW_PLACEHOLDER_PROVIDERS = "1";
process.env.AI_PROVIDER = "openai-compatible";
process.env.OPENAI_API_KEY = "test-key";
process.env.AI_COST_PER_1K_TOKENS_PAISA = "100";
process.env.AI_MONTHLY_BUDGET_PAISA = "500";
process.env.LOG_LEVEL = "silent";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

let gateway: typeof import("../src/providers/ai/gateway.js");
let prisma: typeof import("../src/lib/prisma.js")["prisma"];

beforeAll(async () => {
  gateway = await import("../src/providers/ai/gateway.js");
  ({ prisma } = await import("../src/lib/prisma.js"));
}, 120_000);

afterEach(() => {
  fetchMock.mockReset();
});

function completion(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
    }),
  } as Response;
}

describe("AI budget guard (production)", () => {
  it("over budget: throws 429 AI_BUDGET_EXCEEDED and never falls back to the offline engine", async () => {
    await prisma.aiUsageLog.create({
      data: { provider: "openai-compatible", model: "gpt-4o-mini", latencyMs: 5, success: true, costEstimatePaisa: 500 },
    });
    const err = await gateway
      .askAgroAgent("When should I apply urea to my rice field?", { lang: "en", requestId: "prod-over-1" })
      .catch((e: unknown) => e);
    expect((err as { status?: number }).status).toBe(429);
    expect((err as { code?: string }).code).toBe("AI_BUDGET_EXCEEDED");
    expect(fetchMock).not.toHaveBeenCalled();
    // A refusal leaves no reservation behind.
    expect(await prisma.aiUsageLog.count({ where: { requestId: "prod-over-1" } })).toBe(0);

    await prisma.aiUsageLog.deleteMany({ where: { requestId: null, provider: "openai-compatible", costEstimatePaisa: 500 } });
  });

  it("metering unavailable: refuses with 503 instead of spending unmetered", async () => {
    const spy = vi.spyOn(prisma.aiUsageLog, "create").mockRejectedValueOnce(new Error("db down"));
    const err = await gateway
      .askAgroAgent("When should I apply urea to my rice field?", { lang: "en", requestId: "prod-meter-1" })
      .catch((e: unknown) => e);
    spy.mockRestore();
    expect((err as { status?: number }).status).toBe(503);
    expect((err as { code?: string }).code).toBe("AI_METERING_UNAVAILABLE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("within budget: the hosted provider still answers and the reservation settles", async () => {
    fetchMock.mockResolvedValueOnce(completion("Apply urea in 3 splits at tillering."));
    const answer = await gateway.askAgroAgent("When should I apply urea to my rice field?", { lang: "en", requestId: "prod-ok-1" });
    expect(answer.provider).toBe("openai-compatible");
    const rows = await prisma.aiUsageLog.findMany({ where: { requestId: "prod-ok-1" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].success).toBe(true);
    expect(rows[0].costEstimatePaisa ?? 0).toBeGreaterThan(0);
  });
});
