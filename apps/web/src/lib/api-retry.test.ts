import { describe, expect, it } from "vitest";
import { retryDelayMs } from "./api.js";

/**
 * F-08 from the 10k-concurrency audit.
 *
 * Retries used to be exactly 300 ms then 900 ms. Every client that failed at the
 * same moment — which is what a degrading server produces, since they all failed
 * for the same reason at the same time — retried at the same moment, so the
 * retries arrived as three synchronised waves that kept the dependency
 * overloaded. These assertions pin jitter, the Retry-After override and the cap.
 */

const withHeader = (value: string) => new Response(null, { status: 503, headers: { "Retry-After": value } });

describe("retry delay", () => {
  it("jitters the fixed schedule instead of repeating it exactly", () => {
    const samples = Array.from({ length: 200 }, () => retryDelayMs(0));
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    // Full jitter over [0.5x, 1.5x] of 300 ms.
    expect(min).toBeGreaterThanOrEqual(150);
    expect(max).toBeLessThanOrEqual(450);
    // A fixed schedule would make every sample identical.
    expect(new Set(samples.map((s) => s.toFixed(3))).size).toBeGreaterThan(50);
  });

  it("grows with the attempt index", () => {
    const first = Array.from({ length: 200 }, () => retryDelayMs(0));
    const second = Array.from({ length: 200 }, () => retryDelayMs(1));
    expect(Math.max(...first)).toBeLessThan(Math.min(...second));
  });

  it("honours a server-directed Retry-After", () => {
    for (const value of ["2", "1", "0"]) {
      const delay = retryDelayMs(0, withHeader(value));
      expect(delay).toBeGreaterThanOrEqual(Number(value) * 1000);
    }
    // An HTTP-date form is accepted too.
    const at = new Date(Date.now() + 3_000).toUTCString();
    expect(retryDelayMs(0, withHeader(at))).toBeGreaterThanOrEqual(2_000);
  });

  it("caps a hostile or absurd Retry-After so the UI cannot stall", () => {
    expect(retryDelayMs(0, withHeader("99999"))).toBeLessThanOrEqual(10_250);
    // A Retry-After in the past, or garbage, falls back to the jittered schedule.
    expect(retryDelayMs(0, withHeader(new Date(Date.now() - 60_000).toUTCString()))).toBeLessThanOrEqual(450);
    expect(retryDelayMs(0, withHeader("not-a-date"))).toBeLessThanOrEqual(450);
  });

  it("falls back to the schedule when the response carries no header", () => {
    const noHeader = new Response(null, { status: 503 });
    expect(retryDelayMs(0, noHeader)).toBeLessThanOrEqual(450);
    expect(retryDelayMs(0, noHeader)).toBeGreaterThanOrEqual(150);
  });
});
