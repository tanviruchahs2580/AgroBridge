/**
 * lib/labels — the raw-enum fallback contract (F-37).
 *
 * `SellCrop` used to call `t(GRADE_KEYS[raw])` directly, so a `qualityGrade` the
 * map did not know (the API types it `string | null`) became `t(undefined)` and
 * threw during render — the whole Sell-Crop screen collapsed into the
 * ErrorBoundary for one unexpected value. Every label helper now routes through
 * `fromMap`, whose contract is: known value → dictionary copy, unknown value →
 * the raw string, never a throw.
 */
import { describe, it, expect } from "vitest";
import { GRADES, qualityGradeLabel, cropLabel } from "./labels";
import { dict } from "./i18n";

describe("lib/labels — quality grades (F-37)", () => {
  it("labels the known grades in both languages, in picker order", () => {
    expect(GRADES).toEqual(["A", "B", "C"]);
    expect(qualityGradeLabel("A", "bn")).toBe(dict.gradeA.bn);
    expect(qualityGradeLabel("B", "en")).toBe(dict.gradeB.en);
    expect(qualityGradeLabel("C", "bn")).toBe(dict.gradeC.bn);
  });

  it("falls back to the raw value for a grade the map does not know, instead of throwing", () => {
    // The regression: this call used to be `t(undefined, lang)` → TypeError.
    expect(() => qualityGradeLabel("D", "bn")).not.toThrow();
    expect(qualityGradeLabel("D", "bn")).toBe("D");
    expect(qualityGradeLabel("GRADE_X", "en")).toBe("GRADE_X");
  });
});

describe("lib/labels — crops keep the same contract", () => {
  it("labels a known crop and passes an unknown one through", () => {
    expect(cropLabel("RICE", "bn")).toBe(dict.cropRICE.bn);
    expect(cropLabel("QUINOA", "bn")).toBe("QUINOA");
  });
});
