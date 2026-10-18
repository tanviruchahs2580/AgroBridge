import { describe, expect, it } from "vitest";
import { hostedAiCostProblem } from "../src/config/env.js";

/**
 * A7-05 regression: with AI_PROVIDER=openai-compatible the monthly spend
 * breaker multiplies usage by AI_COST_PER_1K_TOKENS_PAISA. The shipped
 * default of 0 made the breaker inert, so production now refuses to start
 * until a real price is configured. The offline engine spends nothing and
 * keeps the default.
 */
describe("A7-05: hosted AI providers cannot boot with an inert cost model", () => {
  it("reports a problem for a hosted provider with cost 0", () => {
    expect(hostedAiCostProblem({ AI_PROVIDER: "openai-compatible", AI_COST_PER_1K_TOKENS_PAISA: 0 })).toMatch(/must be > 0/);
  });

  it("allows a hosted provider with a real price and the offline engine with the default", () => {
    expect(hostedAiCostProblem({ AI_PROVIDER: "openai-compatible", AI_COST_PER_1K_TOKENS_PAISA: 30 })).toBeNull();
    expect(hostedAiCostProblem({ AI_PROVIDER: "offline", AI_COST_PER_1K_TOKENS_PAISA: 0 })).toBeNull();
  });
});
