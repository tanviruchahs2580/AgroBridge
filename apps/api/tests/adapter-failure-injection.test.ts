import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { env } from "../src/config/env.js";
import { resetResilience, resilienceState } from "../src/providers/resilience.js";
import { sendSms } from "../src/providers/notification/sms.js";
import { S3StorageProvider } from "../src/providers/storage/s3.js";

/**
 * API-07: failure injection for the two adapters the suite never exercised.
 *
 *  - the notification sandbox provider must never throw and must report
 *    `delivered: false` for any recipient/text (an OTP request cannot fail
 *    because the demo gateway is a no-op);
 *  - the S3 adapter runs against a real local HTTP server (same pattern as
 *    tests/sms-provider.test.ts and tests/resilience.test.ts), pinning the
 *    shared resilience policy end to end: a hung server surfaces a typed
 *    timeout quickly, a 500 is retried exactly once before failing, and a
 *    final 403 is never retried.
 */

function withServer(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<{ url: string; hits: () => number; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    let hits = 0;
    const server: Server = createServer((req, res) => {
      hits++;
      handler(req, res);
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        url: `http://127.0.0.1:${port}`,
        hits: () => hits,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

let closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.map((c) => c()));
  closers = [];
  // The S3 breaker/bulkhead bookkeeping is process-local and shared by name.
  resetResilience("s3");
});

/** Provider pointed at the local server; tiny timeout for the timeout case. */
function s3Against(url: string, timeoutMs?: number) {
  return new S3StorageProvider("test-bucket", "us-east-1", "AKIDEXAMPLE", "test-secret", url, timeoutMs);
}

describe("notification sandbox provider (never throws)", () => {
  it("is the configured no-op in tests and reports delivered:false for any recipient and text", async () => {
    expect(["sandbox", "none"]).toContain(env.SMS_PROVIDER);
    const samples: [string, string][] = [
      ["01712345678", "AgroBridge verification code: 123456"],
      ["+8801712345678", ""],
      ["", "x".repeat(2_000)],
    ];
    for (const [phone, text] of samples) {
      const result = await sendSms(phone, text);
      expect(result.delivered).toBe(false);
      expect(result.provider).toBe(env.SMS_PROVIDER);
    }
  });
});

describe("S3 adapter failure injection", () => {
  it("a hung server surfaces a typed timeout, bounded and quickly", async () => {
    const srv = await withServer(() => {
      /* accepted, never answered — the client must give up on its own */
    });
    closers.push(srv.close);

    const started = Date.now();
    const err = await s3Against(srv.url, 80)
      .save("timeout.jpg", Buffer.from("bytes"))
      .catch((e: unknown) => e);
    const elapsed = Date.now() - started;

    // Bounds: one attempt (80ms) + one retry + jitter ≤ retryDelay ceiling (300ms).
    expect(elapsed).toBeLessThan(2_000);
    expect((err as { name?: string }).name).toMatch(/TimeoutError|AbortError/);
    expect(srv.hits()).toBe(2); // the default policy retries a timeout once
    expect(resilienceState()["s3"]?.consecutiveFailures).toBe(1);
  });

  it("500 twice: a single retry, then the failure is surfaced", async () => {
    const srv = await withServer((_req, res) => res.writeHead(500).end("upstream down"));
    closers.push(srv.close);

    const err = await s3Against(srv.url)
      .save("failed.jpg", Buffer.from("bytes"))
      .catch((e: unknown) => e);

    expect((err as Error).message).toMatch(/S3 PUT request failed 500/);
    expect((err as { status?: number }).status).toBe(500); // typed upstream error survives
    expect(srv.hits()).toBe(2); // first attempt + exactly one retry
    expect(resilienceState()["s3"]?.consecutiveFailures).toBe(1);
  });

  it("403 is a final answer: one attempt, no retry", async () => {
    const srv = await withServer((_req, res) => res.writeHead(403).end("forbidden"));
    closers.push(srv.close);

    const err = await s3Against(srv.url)
      .save("denied.jpg", Buffer.from("bytes"))
      .catch((e: unknown) => e);

    expect((err as Error).message).toMatch(/S3 upload failed 403/);
    expect(srv.hits()).toBe(1);
    // A final 4xx is a completed exchange, not a provider outage: the call
    // itself succeeded and the breaker records no failure.
    expect(resilienceState()["s3"]?.consecutiveFailures).toBe(0);
  });
});
