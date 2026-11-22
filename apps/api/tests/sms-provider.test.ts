import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { maskPhone, sendViaHttp, sendSms } from "../src/providers/notification/sms.js";
import { env } from "../src/config/env.js";
import { registry } from "../src/infrastructure/metrics.js";

/**
 * HTTP SMS gateway adapter (AUD-164): the delivery path that makes real OTPs
 * possible once the operator sets SMS_PROVIDER=http + credentials. The
 * transport is exercised against a real local server — payload shape, bearer
 * auth, one bounded retry on 5xx, and no retry on a final 4xx.
 */
function withServer(handler: (req: import("node:http").IncomingMessage, body: string, res: import("node:http").ServerResponse) => void): Promise<{ url: string; close: () => Promise<void>; requests: { body: string; auth?: string }[] }> {
  return new Promise((resolve) => {
    const requests: { body: string; auth?: string }[] = [];
    const server: Server = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        requests.push({ body, auth: req.headers.authorization });
        handler(req, body, res);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        url: `http://127.0.0.1:${port}/send`,
        requests,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

let closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.map((c) => c()));
  closers = [];
});

describe("HTTP SMS gateway", () => {
  it("posts {to, text, senderId} with bearer auth and reports delivery", async () => {
    const srv = await withServer((_req, _body, res) => res.writeHead(200).end("ok"));
    closers.push(srv.close);

    const result = await sendViaHttp({ url: srv.url, key: "secret-key", senderId: "AgroBridge" }, "01712345678", "code 123456");
    expect(result).toEqual({ delivered: true, provider: "http" });
    expect(srv.requests).toHaveLength(1);
    expect(JSON.parse(srv.requests[0]!.body)).toEqual({ to: "01712345678", text: "code 123456", senderId: "AgroBridge" });
    expect(srv.requests[0]!.auth).toBe("Bearer secret-key");
  });

  it("retries exactly once on 5xx and succeeds on the second attempt", async () => {
    let calls = 0;
    const srv = await withServer((_req, _body, res) => {
      calls++;
      if (calls === 1) res.writeHead(503).end("busy");
      else res.writeHead(200).end("ok");
    });
    closers.push(srv.close);

    const result = await sendViaHttp({ url: srv.url }, "01712345678", "code 123456");
    expect(result.delivered).toBe(true);
    expect(calls).toBe(2);
  });

  it("does not retry a final 4xx and reports the status", async () => {
    const srv = await withServer((_req, _body, res) => res.writeHead(400).end("bad number"));
    closers.push(srv.close);

    const result = await sendViaHttp({ url: srv.url }, "01712345678", "code 123456");
    expect(result.delivered).toBe(false);
    expect(result.error).toBe("HTTP 400");
    expect(srv.requests).toHaveLength(1);
  });

  it("masks phone numbers for logs", () => {
    expect(maskPhone("01712345678")).toBe("017***5678");
  });
});

/**
 * WP-04 (SMS readiness): a delivery path with no metrics cannot be alerted on,
 * and a hung gateway must surface as "gateway unreachable" inside the bounded
 * window rather than pinning a request. The outcome labels here are what the
 * activation runbook (docs/runbooks/sms-activation.md) tells the operator to
 * alert on once a sink exists.
 */
describe("SMS send metric and bounded timeout", () => {
  it("counts delivered, rejected and unreachable outcomes on sms_send_total", async () => {
    const del = await withServer((_req, _body, res) => res.writeHead(200).end("ok"));
    closers.push(del.close);
    const rej = await withServer((_req, _body, res) => res.writeHead(403).end("no"));
    closers.push(rej.close);

    env.SMS_PROVIDER = "http";
    const prevUrl = env.SMS_API_URL;
    try {
      env.SMS_API_URL = del.url;
      await sendSms("01712345678", "hello");
      env.SMS_API_URL = rej.url;
      await sendSms("01712345678", "hello");
    } finally {
      env.SMS_API_URL = prevUrl;
      env.SMS_PROVIDER = "sandbox";
    }

    const values = (await registry.getMetricsAsJSON()) as { name: string; values: { labels: Record<string, string>; value: number }[] }[];
    const series = values.find((m) => m.name === "agrobridge_sms_send_total")?.values ?? [];
    const outcome = (provider: string) => series.filter((v) => v.labels.provider === provider).map((v) => `${v.labels.outcome}=${v.value}`).join(",");
    expect(outcome("http")).toContain("delivered=1");
    expect(outcome("http")).toContain("rejected=1");
  });

  it("counts dropped and sandbox messages with their provider label", async () => {
    env.SMS_PROVIDER = "none";
    await sendSms("01712345678", "hello");
    env.SMS_PROVIDER = "sandbox";
    await sendSms("01712345678", "hello");

    const values = (await registry.getMetricsAsJSON()) as { name: string; values: { labels: Record<string, string>; value: number }[] }[];
    const series = values.find((m) => m.name === "agrobridge_sms_send_total")?.values ?? [];
    expect(series.some((v) => v.labels.provider === "none" && v.labels.outcome === "dropped")).toBe(true);
    expect(series.some((v) => v.labels.provider === "sandbox" && v.labels.outcome === "sandbox")).toBe(true);
    env.SMS_PROVIDER = "sandbox";
  });

  it("a hung gateway surfaces 'gateway unreachable' within the bounded window", async () => {
    const srv = await withServer(() => {
      /* never responds */
    });
    closers.push(srv.close);

    const result = await sendViaHttp({ url: srv.url }, "01712345678", "code 123456");
    expect(result.delivered).toBe(false);
    expect(result.error).toBe("gateway unreachable");
  }, 30_000);

  it("treats a 200 with an unexpected body as delivered (fire-and-forget contract)", async () => {
    const srv = await withServer((_req, _body, res) => res.writeHead(200).end("<html>sent</html>"));
    closers.push(srv.close);

    const result = await sendViaHttp({ url: srv.url }, "01712345678", "code 123456");
    expect(result.delivered).toBe(true);
  });
});
