import { describe, expect, it } from "vitest";
import { corsOrigins } from "../src/config/env.js";

/**
 * AUD-106 regression: a production deployment whose WEB_ORIGIN still lists
 * `http://localhost:5173` once answered CORS preflights for any locally-served
 * page. Plain-http localhost origins are now dropped in production; the
 * Capacitor `https://localhost` origin and the docker dev opt-in are kept.
 */
describe("AUD-106: production CORS origin policy", () => {
  it("drops plain-http localhost origins in production but keeps real and Capacitor origins", () => {
    const raw = "https://agro.example.com,http://localhost:5173,http://127.0.0.1:4000,https://localhost";
    expect(corsOrigins(raw, { prod: true })).toEqual(["https://agro.example.com", "https://localhost"]);
  });

  it("development keeps the full list, and the docker stack re-opts dev origins in", () => {
    const raw = "https://agro.example.com,http://localhost:8080";
    expect(corsOrigins(raw, { prod: false })).toEqual(["https://agro.example.com", "http://localhost:8080"]);
    expect(corsOrigins(raw, { prod: true, allowDevOrigins: true })).toEqual(["https://agro.example.com", "http://localhost:8080"]);
  });

  it("never lets an unparseable entry match an origin", () => {
    expect(corsOrigins("not-a-url,https://ok.example.com", { prod: true })).toEqual(["https://ok.example.com"]);
  });
});
