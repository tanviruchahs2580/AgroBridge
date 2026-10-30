import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

/**
 * Shared ephemeral HTTP stub servers for adapter tests. They were copied into
 * each test file until jscpd pushed the repository duplication budget over its
 * ratchet; one implementation lives here now.
 *
 * Both bind 127.0.0.1 on a random port and are closed by the caller.
 */
export function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
  path = ""
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
        url: `http://127.0.0.1:${port}${path}`,
        hits: () => hits,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

/**
 * Variant that buffers each request body (and the Authorization header) so
 * payload-shape assertions are possible; used by the HTTP SMS gateway tests.
 */
export function withServerAndBody(
  handler: (req: IncomingMessage, body: string, res: ServerResponse) => void,
  path = ""
): Promise<{ url: string; close: () => Promise<void>; requests: { body: string; auth?: string }[] }> {
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
        url: `http://127.0.0.1:${port}${path}`,
        requests,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
