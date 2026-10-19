import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { maskPhone, sendViaHttp } from "../src/providers/notification/sms.js";

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
