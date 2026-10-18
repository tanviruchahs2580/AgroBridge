// E-W3 / A5-01 (AUD-126): the Home weather card must disclose provenance — the
// local time the payload was fetched and the source it came from. The load-
// bearing case is the cache hit: the line must still show the ORIGINAL fetch
// time (labelled as a cached copy), never the time the cached payload was served.
import { describe, expect, it } from "vitest";
import { weatherProvenanceLine } from "./weatherProvenance";
import { dateLocale } from "../../lib/format";

const FETCHED_AT = "2026-10-18T09:30:00.000Z";

/** Same local HH:MM the product shows (kept locale-derived to avoid TZ flakiness). */
function hhmm(iso: string, lang: "bn" | "en"): string {
  return new Intl.DateTimeFormat(dateLocale(lang), { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

describe("features/home/weatherProvenance — as-of line (A5-01)", () => {
  it("renders the local fetched time and the source, with no cached marker when fresh", () => {
    const line = weatherProvenanceLine({ fetchedAt: FETCHED_AT, source: "openweather", cached: false }, "en");
    expect(line).toContain(hhmm(FETCHED_AT, "en"));
    expect(line).toContain("openweather");
    expect(line).not.toContain("cached");
  });

  it("keeps the ORIGINAL fetched time on a cache hit and labels the cached copy", () => {
    const fresh = weatherProvenanceLine({ fetchedAt: FETCHED_AT, source: "openweather", cached: false }, "en");
    const cached = weatherProvenanceLine({ fetchedAt: FETCHED_AT, source: "openweather", cached: true }, "en");
    // Same instant in ⇒ same displayed time out: a cache reuse never re-labels
    // the payload with the response time, and it says so instead.
    expect(cached).toContain(hhmm(FETCHED_AT, "en"));
    expect(cached).not.toBe(fresh);
    expect(cached).toContain("cached copy");
    // The line is localised; the source slug stays verbatim in both languages.
    const bn = weatherProvenanceLine({ fetchedAt: FETCHED_AT, source: "openweather", cached: true }, "bn");
    expect(bn).not.toBe(cached);
    expect(bn).toContain("openweather");
  });
});
