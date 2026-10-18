import { describe, expect, it } from "vitest";
import { pino } from "pino";
import { LOG_REDACT_PATHS } from "../src/shared/logging/logger.js";

/**
 * AUD-113 regression: the redaction list covers farmer PII (phone) and
 * location (lat/lng) plus refreshToken, not just the original credential keys.
 */
describe("AUD-113: log redaction covers PII paths beyond the original list", () => {
  it("redacts phone/coordinates/refresh tokens at top level and nested", () => {
    const chunks: string[] = [];
    const stream = { write: (chunk: string) => void chunks.push(chunk) };
    const testLogger = pino({ redact: LOG_REDACT_PATHS, base: undefined }, stream as never);
    testLogger.info(
      { phone: "01712345678", user: { refreshToken: "rt-secret-value", lat: 23.75, lng: 90.4 }, token: "abc", password: "hunter2" },
      "redaction probe"
    );
    const out = chunks.join("");
    expect(out).not.toContain("01712345678");
    expect(out).not.toContain("rt-secret-value");
    expect(out).not.toContain("23.75");
    expect(out).not.toContain("hunter2");
    expect(out).toContain("[Redacted]");
  });
});
