import { describe, expect, it } from "vitest";
import { confidenceSupportKey } from "./supportLabel";

describe("confidence support label (AUD-108)", () => {
  it("maps the heuristic score to coarse bands, never a percentage", () => {
    expect(confidenceSupportKey(0.9, false)).toBe("supportHigh");
    expect(confidenceSupportKey(0.7, false)).toBe("supportHigh");
    expect(confidenceSupportKey(0.5, false)).toBe("supportModerate");
    expect(confidenceSupportKey(0.3, false)).toBe("lowConfidence");
    expect(confidenceSupportKey(0.9, true)).toBe("lowConfidence");
  });
});
