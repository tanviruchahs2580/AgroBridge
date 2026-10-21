import { describe, expect, it } from "vitest";
import request from "supertest";
import { pino } from "pino";
import type { NextFunction, Request, Response } from "express";
import { app } from "./helpers.js";
import { logger } from "../src/shared/logging/logger.js";
import { currentTraceFields, parseTraceparent, requestContext } from "../src/middleware/context.js";

/**
 * W3C trace context: a well-formed incoming `traceparent` is adopted and
 * echoed, anything else is replaced with a fresh valid context, `req.traceId`
 * is exposed, and the shared logger carries the trace id as a base field via
 * the request-scoped store. The log assertion goes through the exported
 * helpers/mixin rather than parsing stdout, so it pins the wiring itself.
 */

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const PARENT = "00f067aa0ba902b7";
const VALID = `00-${TRACE}-${PARENT}-01`;
const VALID_SHAPE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

describe("traceparent propagation over HTTP", () => {
  it("adopts a well-formed incoming context and echoes it on the response", async () => {
    const res = await request(app).get("/health").set("traceparent", VALID);
    expect(res.status).toBe(200);
    expect(res.headers.traceparent).toBe(VALID);
  });

  it("replaces malformed or untrusted input with a fresh well-formed context", async () => {
    const malformed = [
      "garbage",
      "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7", // no flags
      `00-${"0".repeat(32)}-${PARENT}-01`, // all-zero trace id is the "unknown" sentinel
      `00-${TRACE}-${"0".repeat(16)}-01`, // all-zero parent id
      `0f-${TRACE}-${PARENT}-01`, // unsupported version
      `00-${TRACE.toUpperCase()}-${PARENT}-01`, // W3C is lower-case hex
    ];
    for (const bad of malformed) {
      const res = await request(app).get("/health").set("traceparent", bad);
      expect(res.status).toBe(200);
      expect(res.headers.traceparent).toMatch(VALID_SHAPE);
      expect(res.headers.traceparent).not.toBe(bad);
      expect(res.headers.traceparent).not.toContain("00000000000000000000000000000000");
    }
  });

  it("generates a context when no traceparent is sent", async () => {
    const res = await request(app).get("/health");
    expect(res.headers.traceparent).toMatch(VALID_SHAPE);
  });

  it("parseTraceparent accepts exactly the version-00 shape", () => {
    expect(parseTraceparent(undefined)).toBeNull();
    expect(parseTraceparent(["array"])).toBeNull();
    expect(parseTraceparent(VALID)).toEqual({ traceId: TRACE, parentId: PARENT, flags: "01" });
    expect(parseTraceparent(`00-${TRACE}-${PARENT}-zz`)).toBeNull();
  });
});

describe("request-scoped trace fields", () => {
  /** Drives the middleware with minimal req/res doubles, resolving inside next(). */
  function run<T>(headers: Record<string, string>, inside: (req: Request) => T): Promise<{ result: T; headers: Record<string, string> }> {
    const req = { headers } as unknown as Request;
    const set: Record<string, string> = {};
    const res = {
      setHeader: (name: string, value: string) => {
        set[name.toLowerCase()] = value;
      },
    } as unknown as Response;
    const asError = (e: unknown) => (e instanceof Error ? e : new Error(String(e)));
    return new Promise((resolve, reject) => {
      try {
        requestContext(req, res, (() => {
          try {
            resolve({ result: inside(req), headers: set });
          } catch (e) {
            reject(asError(e));
          }
        }) as NextFunction);
      } catch (e) {
        reject(asError(e));
      }
    });
  }

  it("exposes req.traceId and sets the response header", async () => {
    const { result, headers } = await run({ traceparent: VALID, "x-request-id": "req-123" }, (req) => ({
      traceId: req.traceId,
      requestId: req.requestId,
    }));
    expect(result.traceId).toBe(TRACE);
    expect(result.requestId).toBe("req-123");
    expect(headers.traceparent).toBe(VALID);
    expect(headers["x-request-id"]).toBe("req-123");
  });

  it("populates the request store the logger's mixin reads", async () => {
    const { result } = await run({ traceparent: VALID, "x-request-id": "req-456" }, () => currentTraceFields());
    expect(result).toEqual({ requestId: "req-456", traceId: TRACE });

    // The store is only active inside a request — module-scope logs stay clean.
    expect(currentTraceFields()).toEqual({});
  });

  it("the shared logger is wired to the request-scoped mixin", async () => {
    // pino exports the symbol table at runtime; its typings do not declare it.
    const { mixinSym } = (pino as unknown as { symbols: { mixinSym: symbol } }).symbols;
    const mixin = (logger as unknown as Record<symbol, unknown>)[mixinSym];
    expect(mixin).toBe(currentTraceFields);

    // And functionally: a log emitted in request scope carries both ids.
    const chunks: string[] = [];
    const probe = pino({ base: undefined, mixin: mixin as () => Record<string, unknown> }, { write: (c: string) => void chunks.push(c) } as never);
    const { result } = await run({ traceparent: VALID, "x-request-id": "req-789" }, () => {
      probe.info("probe");
      return null;
    });
    void result;
    expect(JSON.parse(chunks.join(""))).toMatchObject({ requestId: "req-789", traceId: TRACE });
  });
});
