import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NextFunction, Request, Response } from "express";

/**
 * AUD-V3: /metrics must require METRICS_TOKEN on every request in production.
 * The previous private-remoteAddress allowance was an allow-everything rule on
 * serverless platforms — Vercel's internal load balancer is the socket peer of
 * every request, so the whole internet appeared as a private network and
 * anonymous scrapers received full Prometheus output (verified live against
 * production 2026-10-23). These tests pin the guard's two regimes without
 * booting the whole app: config/env is mocked so isProd and METRICS_TOKEN are
 * controllable per test.
 */

const envMock = vi.hoisted(() => ({ env: { METRICS_TOKEN: "" }, isProd: false }));

vi.mock("../src/config/env.js", () => envMock);

const { metricsGuard } = await import("../src/middleware/metricsGuard.js");

type Ctx = { passed: boolean; error?: unknown };

function runGuard(headers: Record<string, string> = {}, remoteAddress = "203.0.113.9"): Ctx {
  const ctx: Ctx = { passed: false };
  const req = { headers, socket: { remoteAddress } } as unknown as Request;
  metricsGuard(req, {} as Response, ((err?: unknown) => { ctx.error = err; ctx.passed = !err; }) as NextFunction);
  return ctx;
}

beforeEach(() => {
  envMock.env.METRICS_TOKEN = "";
  envMock.isProd = false;
});

describe("metricsGuard — production (token always required)", () => {
  beforeEach(() => {
    envMock.isProd = true;
  });

  it("rejects an anonymous request even from a private-looking address (the serverless reality)", () => {
    envMock.env.METRICS_TOKEN = "secret-token";
    const ctx = runGuard({}, "10.0.0.7"); // platform LB address
    expect(ctx.passed).toBe(false);
  });

  it("rejects a wrong bearer token", () => {
    envMock.env.METRICS_TOKEN = "secret-token";
    const ctx = runGuard({ authorization: "Bearer wrong" });
    expect(ctx.passed).toBe(false);
  });

  it("accepts the correct bearer token from any address", () => {
    envMock.env.METRICS_TOKEN = "secret-token";
    const ctx = runGuard({ authorization: "Bearer secret-token" }, "203.0.113.9");
    expect(ctx.passed).toBe(true);
  });

  it("fails closed for everyone when METRICS_TOKEN is unset (ops misconfiguration ≠ fleet recon)", () => {
    const anon = runGuard({});
    const privateAddr = runGuard({}, "127.0.0.1");
    expect(anon.passed).toBe(false);
    expect(privateAddr.passed).toBe(false);
  });
});

describe("metricsGuard — non-production (developer/docker convenience)", () => {
  it("allows loopback without a token (local Prometheus)", () => {
    const ctx = runGuard({}, "::1");
    expect(ctx.passed).toBe(true);
  });

  it("allows a private-network address without a token", () => {
    const ctx = runGuard({}, "192.168.1.20");
    expect(ctx.passed).toBe(true);
  });

  it("requires a token from a public address when one is configured", () => {
    envMock.env.METRICS_TOKEN = "dev-token";
    expect(runGuard({}, "203.0.113.9").passed).toBe(false);
    expect(runGuard({ authorization: "Bearer dev-token" }, "203.0.113.9").passed).toBe(true);
  });

  it("rejects a public anonymous request even with no token configured", () => {
    expect(runGuard({}, "203.0.113.9").passed).toBe(false);
  });
});
