import { describe, expect, it } from "vitest";
import { formatBDT, paisaToTaka, takaToPaisa } from "./format.js";

/**
 * Regression guard for the money-line audit: every displayed amount comes from
 * the same paisa-precision formatter, so displayed receipt line items must sum
 * to the displayed total. (Old behaviour rounded whole taka per line:
 * 1,850 − 55.50 + 50 rendered as 1,850 − 56 + 50 ≠ the 1,845 total shown.)
 */
const BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯";

/** Numeric value a user reads off a formatted BDT string, in taka (both digit systems). */
function readDisplayedTaka(displayed: string): number {
  const latin = [...displayed]
    .map((ch) => {
      const i = BENGALI_DIGITS.indexOf(ch);
      return i >= 0 ? String(i) : ch;
    })
    .join("");
  const m = latin.match(/\d[\d,]*(?:\.\d+)?/);
  if (!m) throw new Error(`no number found in "${displayed}"`);
  // Intl puts the sign before the currency symbol (e.g. "-BDT55.50", "-৳৫৫.৫০"),
  // and newer CLDR may use U+2212 — detect either anywhere in the string.
  const negative = latin.includes("-") || latin.includes("−");
  return Number(m[0].replace(/,/g, "")) * (negative ? -1 : 1);
}

describe("formatBDT", () => {
  it("renders whole taka without decimals", () => {
    expect(readDisplayedTaka(formatBDT(185000, "en"))).toBe(1850);
    expect(formatBDT(185000, "en")).not.toContain(".");
    expect(formatBDT(185000, "bn")).not.toContain(".");
  });

  it("shows 2 decimals only when paisa are present", () => {
    expect(formatBDT(184450, "en")).toContain("1,844.50");
    expect(readDisplayedTaka(formatBDT(184450, "bn"))).toBeCloseTo(1844.5, 2);
  });

  it("keeps displayed 0.50 visible (paisa present ⇒ decimals)", () => {
    expect(formatBDT(50, "en")).toContain("0.50");
  });

  it("displayed line items sum to the displayed total (receipt scenario)", () => {
    // Subtotal 1,850.00 − tier discount 3% (55.50) + delivery 50.00 = 1,844.50.
    const subtotal = 185000;
    const discount = -Math.round(subtotal * 0.03); // −5550 paisa
    const delivery = 5000;
    for (const lang of ["bn", "en"] as const) {
      const shown = [subtotal, discount, delivery].map((p) => readDisplayedTaka(formatBDT(p, lang)));
      const total = readDisplayedTaka(formatBDT(subtotal + discount + delivery, lang));
      expect(shown[0] + shown[1] + shown[2]).toBeCloseTo(total, 2);
    }
  });

  it("property: any paisa amounts displayed then summed equal the displayed sum", () => {
    const cases = [
      [1, 2, 3],
      [99, 101, 50],
      [12345678, 99, -555],
      [4999, 4999, 4999],
    ];
    for (const amounts of cases) {
      for (const lang of ["bn", "en"] as const) {
        const sumShown = amounts.reduce((a, p) => a + readDisplayedTaka(formatBDT(p, lang)), 0);
        const totalShown = readDisplayedTaka(formatBDT(amounts.reduce((a, p) => a + p, 0), lang));
        expect(sumShown).toBeCloseTo(totalShown, 6);
      }
    }
  });

  it("takaToPaisa/paisaToTaka round-trip typical inputs", () => {
    expect(takaToPaisa(1844.5)).toBe(184450);
    expect(paisaToTaka(takaToPaisa(55.5))).toBe(55.5);
  });
});
