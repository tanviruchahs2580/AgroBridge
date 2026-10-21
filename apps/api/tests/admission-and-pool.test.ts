import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import { admissionControl, admissionStats, resetAdmissionState } from "../src/middleware/admission.js";
import { withPoolParams } from "../src/infrastructure/database/prisma.js";
import { env } from "../src/config/env.js";

/**
 * F-05 / F-06 from the 10k-concurrency audit.
 *
 * F-05: at 10 000 concurrent sessions the instance queued without bound — 44 % of
 * requests waited longer than 30 s and p95 reached 56 s. Past a ceiling the API
 * must now answer 503 + Retry-After immediately instead of joining the queue.
 *
 * A dedicated Express app is used rather than the shared one so the ceiling can
 * be set to 1 deterministically; `admissionControl` reads the limit per request,
 * so the value is adjustable at runtime.
 */

const setCeiling = (n: number) => {
  (env as { MAX_CONCURRENT_REQUESTS: number }).MAX_CONCURRENT_REQUESTS = n;
};

/** Test app whose first /api route blocks on a promise the test controls. */
function buildApp() {
  const local = express();
  local.use("/api/", admissionControl);
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  local.get("/api/v1/hold", async (_req, res) => {
    await gate;
    res.json({ ok: true });
  });
  local.get("/api/v1/fast", (_req, res) => {
    res.json({ ok: true });
  });
  // Ops endpoints are deliberately NOT behind the guard (mounted on /api/ only):
  // an on-call engineer must be able to see that the instance is drowning.
  local.get("/health", (_req, res) => {
    res.json({ ok: true });
  });
  return { local, release: () => release() };
}

const originalCeiling = env.MAX_CONCURRENT_REQUESTS;

afterEach(() => {
  setCeiling(originalCeiling);
  resetAdmissionState();
});

describe("admission control (F-05)", () => {
  it("sheds past the ceiling with 503 + Retry-After, then recovers as slots free", async () => {
    const { local, release } = buildApp();
    setCeiling(1);
    resetAdmissionState();

    // NB: supertest is lazy — the request only leaves once it is awaited, so a
    // bare `.get()` would never occupy the slot this test depends on.
    const held = request(local).get("/api/v1/hold").then((r) => r);
    await new Promise((r) => setTimeout(r, 50)); // let it take the only slot
    expect(admissionStats().inFlight).toBe(1);

    const shed = await request(local).get("/api/v1/fast");
    expect(shed.status).toBe(503);
    expect(shed.body.ok).toBe(false);
    expect(shed.body.error.code).toBe("OVERLOADED");
    expect(shed.headers["retry-after"]).toBe("1");
    // The shed request never reached a handler.
    expect(admissionStats().shed).toBe(1);

    release();
    await held;

    const after = await request(local).get("/api/v1/fast");
    expect(after.status).toBe(200);
    expect(admissionStats().inFlight).toBe(0);
  });

  it("keeps /health answerable while /api is at its ceiling", async () => {
    const { local, release } = buildApp();
    setCeiling(1);
    resetAdmissionState();

    const held = request(local).get("/api/v1/hold").then((r) => r);
    await new Promise((r) => setTimeout(r, 50));

    const health = await request(local).get("/health");
    expect(health.status).toBe(200);

    release();
    await held;
  });

  it("does not shed at all when the guard is disabled", async () => {
    const { local, release } = buildApp();
    setCeiling(0);
    resetAdmissionState();

    const held = request(local).get("/api/v1/hold").then((r) => r);
    await new Promise((r) => setTimeout(r, 50));

    const parallel = await request(local).get("/api/v1/fast");
    expect(parallel.status).toBe(200);
    expect(admissionStats().shed).toBe(0);

    release();
    await held;
  });
});

describe("prisma pool parameters (F-06)", () => {
  it("appends pool parameters to a PostgreSQL URL", () => {
    expect(withPoolParams("postgresql://dummy:dummy@host:5432/db", 20, 15)).toBe(
      "postgresql://dummy:dummy@host:5432/db?connection_limit=20&pool_timeout=15",
    );
    expect(withPoolParams("postgres://dummy:dummy@host:5432/db?schema=public", 20, 15)).toBe(
      "postgres://dummy:dummy@host:5432/db?schema=public&connection_limit=20&pool_timeout=15",
    );
  });

  it("never overrides a parameter the operator set explicitly", () => {
    expect(withPoolParams("postgresql://dummy:dummy@h/db?connection_limit=5", 20, 15)).toBe(
      "postgresql://dummy:dummy@h/db?connection_limit=5&pool_timeout=15",
    );
  });

  it("leaves SQLite and an unconfigured deployment byte-identical", () => {
    expect(withPoolParams("file:./prisma/dev.db", 20, 15)).toBe("file:./prisma/dev.db");
    expect(withPoolParams("file:./test.db")).toBe("file:./test.db");
    // Nothing configured → the URL is returned unchanged, so prisma.ts passes no
    // datasource override at all and construction is exactly what it was before.
    expect(withPoolParams("postgresql://dummy:dummy@h/db")).toBe("postgresql://dummy:dummy@h/db");
  });

  it("does not re-encode credentials (a pasted password keeps working)", () => {
    const url = "postgresql://user:p%40ss%3Aword@example.com:5432/db";
    const out = withPoolParams(url, 9, 10);
    expect(out).toContain("user:p%40ss%3Aword@example.com:5432/db");
    expect(out).toContain("connection_limit=9&pool_timeout=10");
  });
});
