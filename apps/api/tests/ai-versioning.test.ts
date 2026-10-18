import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app, registerFarmer } from "./helpers.js";
import { KB_VERSION, KNOWLEDGE_BASE, kbVersionOf } from "../src/providers/ai/knowledge.js";
import { PROMPT_VERSION, OpenAiCompatibleProvider } from "../src/providers/ai/openai-compat.js";
import { OfflineAgroEngine } from "../src/providers/ai/offline-engine.js";

/**
 * KB / prompt versioning (A2-04 / A3-07 / A4-06): every advisory response says
 * which knowledge base grounded it (`kbVersion`) and — for the hosted provider
 * — which prompt template produced it (`promptVersion`). The offline engine
 * omits `promptVersion`; its `model` id ("kb-retrieval-v1") is the template
 * identity. See docs/ai.md §Versioning.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KB_VERSION", () => {
  it("is the first 12 hex of sha256 over a stable serialization of the KB", () => {
    expect(KB_VERSION).toMatch(/^[0-9a-f]{12}$/);
    expect(kbVersionOf(KNOWLEDGE_BASE)).toBe(KB_VERSION);
    // Stable against an equivalent corpus serialization (same content).
    expect(kbVersionOf([...KNOWLEDGE_BASE])).toBe(KB_VERSION);
  });

  it("changes when KB content changes", () => {
    const reduced = KNOWLEDGE_BASE.slice(0, -1);
    expect(kbVersionOf(reduced)).not.toBe(KB_VERSION);
    const edited = [{ ...KNOWLEDGE_BASE[0]!, answerEn: KNOWLEDGE_BASE[0]!.answerEn + " Edited." }, ...KNOWLEDGE_BASE.slice(1)];
    expect(kbVersionOf(edited)).not.toBe(KB_VERSION);
  });
});

describe("advisory responses carry the version fields", () => {
  it("offline engine: kbVersion present, promptVersion absent", async () => {
    const f = await registerFarmer();
    const res = await request(app)
      .post("/api/v1/ai/advisory")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .send({ question: "ধানের সেচ কখন দিতে হয়?", lang: "bn" });
    expect(res.status).toBe(200);
    expect(res.body.data.kbVersion).toBe(KB_VERSION);
    expect(res.body.data.promptVersion).toBeUndefined();
  });

  it("the offline engine reports the version of its own (evaluation) corpus", async () => {
    const single = [KNOWLEDGE_BASE[0]!];
    const engine = new OfflineAgroEngine({ corpus: single });
    const answer = await engine.ask("rice blast", { lang: "en" });
    expect(answer.kbVersion).toBe(kbVersionOf(single));
    expect(answer.kbVersion).not.toBe(KB_VERSION);
  });

  it("the hosted adapter reports PROMPT_VERSION and the production KB_VERSION", async () => {
    expect(PROMPT_VERSION).toBe("v1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "Answer." }, finish_reason: "stop" }] }),
      }))
    );
    const provider = new OpenAiCompatibleProvider({ retryDelayMs: 1 });
    expect(provider.promptVersion).toBe("v1");
    const answer = await provider.ask("When should I apply urea to my rice field?", { lang: "en" });
    expect(answer.promptVersion).toBe(PROMPT_VERSION);
    expect(answer.kbVersion).toBe(KB_VERSION);
  });
});
