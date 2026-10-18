import { afterEach, describe, expect, it, vi } from "vitest";
import { dhakaMonthStart } from "../src/modules/payments/routes.js";
import { dhakaDate } from "../src/providers/weather/day.js";
import { OpenWeatherProvider } from "../src/providers/weather/openweather.js";
import { MockWeatherProvider } from "../src/providers/weather/mock.js";

/**
 * AUD-115 (S2): two boundaries were computed in the wrong timezone.
 *  - wallet "this month" used the server's local clock, so on a UTC host the
 *    first six hours of every Dhaka month fell into the previous month;
 *  - forecast days were grouped by the UTC date, so a 18:30Z slot (00:30 in
 *    Dhaka) was labelled with the previous local day.
 * Both now use Asia/Dhaka (UTC+6, no DST).
 */
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Asia/Dhaka boundaries", () => {
  it("dhakaMonthStart returns the Dhaka month start as a UTC instant", () => {
    // 2026-11-01 00:00 Dhaka == 2026-10-31 18:00Z.
    expect(dhakaMonthStart(new Date("2026-10-31T18:00:00Z")).toISOString()).toBe("2026-10-31T18:00:00.000Z");
    expect(dhakaMonthStart(new Date("2026-11-15T10:00:00Z")).toISOString()).toBe("2026-10-31T18:00:00.000Z");
    // 2026-10-01 06:30 Dhaka is still October: start is 2026-09-30 18:00Z.
    expect(dhakaMonthStart(new Date("2026-10-01T00:30:00Z")).toISOString()).toBe("2026-09-30T18:00:00.000Z");
  });

  it("a payment at 2026-10-31T20:00Z counts as November in Dhaka", () => {
    const paidAt = new Date("2026-10-31T20:00:00Z"); // 2026-11-01 02:00 Dhaka
    const start = dhakaMonthStart(new Date("2026-11-01T00:00:00Z"));
    expect(start.toISOString()).toBe("2026-10-31T18:00:00.000Z");
    expect(paidAt.getTime()).toBeGreaterThanOrEqual(start.getTime());

    // Same calendar day in UTC, but 23:59 Dhaka on Oct 31 stays in October.
    const lateOctober = new Date("2026-10-31T17:59:59Z");
    expect(lateOctober.getTime()).toBeLessThan(start.getTime());
  });

  it("dhakaDate groups a 18:30Z forecast slot into the next Dhaka day", () => {
    expect(dhakaDate(new Date("2026-10-31T18:30:00Z"))).toBe("2026-11-01");
    expect(dhakaDate(new Date("2026-10-31T17:30:00Z"))).toBe("2026-10-31");
    expect(dhakaDate("2026-10-31T18:30:00Z")).toBe("2026-11-01"); // string input (openweather dt_txt)
  });

  it("the openweather adapter buckets slots by the Dhaka day", async () => {
    const list = [
      { dt_txt: "2026-10-31 12:00:00", main: { temp_min: 20, temp_max: 30, humidity: 60 }, wind: { speed: 2 } },
      { dt_txt: "2026-10-31 18:00:00", main: { temp_min: 21, temp_max: 31, humidity: 61 }, wind: { speed: 3 }, rain: { "3h": 4 } },
    ];
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ list }) }));

    const out = await new OpenWeatherProvider("test-key").getForecast(25.9, 89.1, 2);
    // The 18:00Z slot is 00:00 on Nov 1 in Dhaka — a separate day, not merged
    // into (or mislabelled as) Oct 31.
    expect(out.map((d) => d.date)).toEqual(["2026-10-31", "2026-11-01"]);
    expect(out[1].rainMm).toBe(4);
  });

  it("the mock adapter emits Dhaka-labelled dates", async () => {
    const out = await new MockWeatherProvider().getForecast(25.9, 89.1, 3);
    expect(out).toHaveLength(3);
    expect(out[0].date).toBe(dhakaDate(new Date()));
    for (const day of out) expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
