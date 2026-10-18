// E-W3 / A4-04 + A2-04: which engine/mode answered must be derivable from the
// gateway's provider/model values — the offline deterministic KB engine vs a
// model-backed answer — with the KB version shortened for the meta line.
import { describe, expect, it } from "vitest";
import { answerModeLabel, isOfflineKbAnswer, shortKbVersion } from "./answerMeta";

describe("features/advisor/answerMeta — provider mode disclosure", () => {
  it("distinguishes the offline KB engine from a model-backed answer", () => {
    expect(isOfflineKbAnswer("offline-agro-engine", "kb-retrieval-v1")).toBe(true);
    expect(isOfflineKbAnswer("openai-compatible", "gpt-4o-mini")).toBe(false);
    // An unrecognised provider is a model-backed answer, never mislabelled as the KB.
    expect(isOfflineKbAnswer("some-new-provider", "model-x")).toBe(false);
    expect(answerModeLabel("offline-agro-engine", "kb-retrieval-v1", "en")).toBe("Knowledge base (KB)");
    expect(answerModeLabel("openai-compatible", "gpt-4o-mini", "en")).toBe("AI model");
    expect(answerModeLabel("openai-compatible", "gpt-4o-mini", "bn")).not.toBe("AI model");
    expect(shortKbVersion("a1b2c3d4e5f6")).toBe("a1b2c3d4");
  });
});
