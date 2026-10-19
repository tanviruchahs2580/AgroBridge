import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import {
  ResilienceError,
  UpstreamHttpError,
  resetResilience,
  resilienceState,
  withResilience,
} from "../src/providers/resilience.js";

/**
 * Shared provider resilience policy (timeout / bounded retry / circuit
 * breaker / bulkhead). Everything runs against a real local HTTP server, like
 * tests/sms-provider.test.ts: the policy wraps real sockets, not mocks, so a
 * timeout is an actual aborted request and a retry is an actual second hit.
 *
 * Fast retry delays and per-test provider names keep the suite deterministic;
 * `resetResilience` clears process-local breaker state between tests.
 */

function withServer(
  handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void
): Promise<{ url: string; hits: () => number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    let hits = 0;
    const server: Server = createServer((req, res) => {
      hits++;
      handler(req, res);
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        url: `http://127.0.0.1:${port}/resource`,
        hits: () => hits,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

/** fetch + non-2xx classification, the shape every adapter uses inside the wrapper. */
function fetchChecked(url: string) {
  return async (signal: AbortSignal): Promise<Response> => {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new UpstreamHttpError(`upstream failed: ${res.status}`, res.status);
    return res;
  };
}

let closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.map((c) => c()));
  closers = [];
  resetResilience();
});

const fast = { retryDelayMs: 1 } as const;

describe("withResilience — retries", () => {
  it("retries a 5xx once and succeeds on the second attempt", async () => {
    let calls = 0;
    const srv = await withServer((_req, res) => {
      calls++;
      if (calls === 1) res.writeHead(503).end("busy");
      else res.writeHead(200).end("ok");
    });
    closers.push(srv.close);

    const res = await withResilience("test:retry-5xx", fetchChecked(srv.url), fast);
    expect(res.status).toBe(200);
    expect(srv.hits()).toBe(2);
    expect(resilienceState()["test:retry-5xx"]).toEqual({ state: "closed", consecutiveFailures: 0, openedAt: null });
  });

  it("does not retry a final 4xx — one attempt, original error rethrown", async () => {
    const srv = await withServer((_req, res) => res.writeHead(400).end("bad request"));
    closers.push(srv.close);

    await expect(withResilience("test:no-retry-4xx", fetchChecked(srv.url), fast)).rejects.toThrow("upstream failed: 400");
    expect(srv.hits()).toBe(1);
  });

  it("retries a network failure once (undici surfaces it as a TypeError)", async () => {
    let calls = 0;
    const transportDown = async (): Promise<Response> => {
      calls++;
      throw new TypeError("fetch failed"); // what a refused connection produces
    };

    await expect(withResilience("test:network", transportDown, fast)).rejects.toThrow("fetch failed");
    expect(calls).toBe(2);
  });
});

describe("withResilience — circuit breaker", () => {
  it("opens after N consecutive failures, rejects fast, and records the state", async () => {
    const srv = await withServer((_req, res) => res.writeHead(500).end("down"));
    closers.push(srv.close);

    const opts = { ...fast, failureThreshold: 2, cooldownMs: 60_000 };
    await expect(withResilience("test:breaker", fetchChecked(srv.url), opts)).rejects.toThrow("upstream failed: 500");
    await expect(withResilience("test:breaker", fetchChecked(srv.url), opts)).rejects.toThrow("upstream failed: 500");
    expect(srv.hits()).toBe(4); // two calls, each with its one retry

    // Third call: refused by policy, the server is not touched again.
    const err = await withResilience("test:breaker", fetchChecked(srv.url), opts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ResilienceError);
    expect((err as ResilienceError).code).toBe("CIRCUIT_OPEN");
    expect(srv.hits()).toBe(4);

    const state = resilienceState()["test:breaker"];
    expect(state).toMatchObject({ state: "open", consecutiveFailures: 2 });
    expect(typeof state?.openedAt).toBe("number");
  });

  it("half-open probe closes the circuit when the provider recovered", async () => {
    let healthy = false;
    const srv = await withServer((_req, res) => {
      if (healthy) res.writeHead(200).end("ok");
      else res.writeHead(500).end("down");
    });
    closers.push(srv.close);

    const opts = { ...fast, failureThreshold: 1, cooldownMs: 40 };
    await expect(withResilience("test:half-open", fetchChecked(srv.url), opts)).rejects.toThrow("upstream failed: 500");
    expect(resilienceState()["test:half-open"]?.state).toBe("open");

    // Cooldown elapses while the provider recovers; the next call is the
    // half-open probe and closes the circuit on success.
    healthy = true;
    await new Promise((r) => setTimeout(r, 80));
    const res = await withResilience("test:half-open", fetchChecked(srv.url), opts);
    expect(res.status).toBe(200);
    expect(resilienceState()["test:half-open"]).toEqual({ state: "closed", consecutiveFailures: 0, openedAt: null });
  });
});

describe("withResilience — bulkhead", () => {
  it("caps in-flight calls per provider; the excess call fails fast with a typed error", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const call = () => withResilience("test:bulkhead", async () => {
      await gate;
      return "done";
    }, { maxConcurrent: 2 });

    const first = call();
    const second = call();
    const excess = await call().catch((e: unknown) => e);
    expect(excess).toBeInstanceOf(ResilienceError);
    expect((excess as ResilienceError).code).toBe("BULKHEAD_FULL");

    release();
    expect(await first).toBe("done");
    expect(await second).toBe("done");
    // Slots are released — the next call is admitted again.
    await expect(call()).resolves.toBe("done");
  });
});

describe("withResilience — timeout", () => {
  it("aborts an attempt whose server never responds, quickly", async () => {
    const srv = await withServer(() => {
      /* accepted, never answered — the client must give up on its own */
    });
    closers.push(srv.close);

    const started = Date.now();
    const err = await withResilience("test:timeout", fetchChecked(srv.url), { ...fast, timeoutMs: 60, retries: 0 }).catch(
      (e: unknown) => e
    );
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(2_000);
    expect((err as { name?: string }).name).toMatch(/TimeoutError|AbortError/);
    expect(srv.hits()).toBe(1);
  });
});
