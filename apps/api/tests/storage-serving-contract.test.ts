import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { LocalStorageProvider } from "../src/providers/storage/local.js";
import { S3StorageProvider } from "../src/providers/storage/s3.js";
import { resetResilience } from "../src/providers/resilience.js";

/**
 * AUD-207 / AUD-208 (found by the run's independent review): the new served-
 * photo path must hold under EVERY storage provider a deployment can choose,
 * not only the default one the route tests exercise end to end.
 *
 *  - local  : get() must resolve keys through the SAME base directory save()
 *             wrote to (UPLOAD_BASE_DIR is the documented knob on serverless
 *             runtimes; before the fix get() resolved against the CWD and
 *             returned null for every stored object).
 *  - s3     : get() must actually fetch the object (it used to return null
 *             unconditionally, so STORAGE_PROVIDER=s3 answered 404 forever).
 *             Exercised against a stub HTTP server, the same pattern the
 *             adapter-failure tests use — no cloud credentials involved.
 */

let closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closers.map((c) => c()));
  closers = [];
  resetResilience("s3");
});

describe("LocalStorageProvider honors its base directory (AUD-207)", () => {
  it("save→get round-trips bytes when a custom baseDir is configured", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agro-storage-audit-"));
    try {
      const provider = new LocalStorageProvider(dir);
      const key = await provider.save("contract.bin", Buffer.from([1, 2, 3, 250]), "image/png");
      expect(key).toBe("uploads/disease/contract.bin");
      const back = await provider.get(key);
      expect(back).not.toBeNull();
      expect(back!.equals(Buffer.from([1, 2, 3, 250]))).toBe(true);

      // Missing objects are null, not an error.
      expect(await provider.get("uploads/disease/absent.bin")).toBeNull();

      // delete also continues to resolve through the same base dir.
      await provider.delete(key);
      expect(await provider.get(key)).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("S3StorageProvider get() fetches objects (AUD-208)", () => {
  function withServer(handler: (req: IncomingMessage, res: ServerResponse) => void) {
    return new Promise<{ url: string; hits: () => number }>((resolve) => {
      let hits = 0;
      const server: Server = createServer((req, res) => {
        hits++;
        handler(req, res);
      });
      server.listen(0, "127.0.0.1", () => {
        const port = (server.address() as { port: number }).port;
        closers.push(() => new Promise((r) => server.close(() => r())));
        resolve({ url: `http://127.0.0.1:${port}`, hits: () => hits });
      });
    });
  }

  function provider(url: string) {
    return new S3StorageProvider("contract-bucket", "us-east-1", "AKIDEXAMPLE", "test-secret", url, 2_000);
  }

  it("returns the object bytes for a 200", async () => {
    const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7]);
    const srv = await withServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(payload);
    });
    const got = await provider(srv.url).get("uploads/disease/x.png");
    expect(got).not.toBeNull();
    expect(got!.equals(payload)).toBe(true);
  });

  it("returns null for a 404 and throws (after exactly one retry) on a 500", async () => {
    const notFound = await withServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    expect(await provider(notFound.url).get("uploads/disease/missing.png")).toBeNull();

    const flaky = await withServer((_req, res) => {
      res.writeHead(500);
      res.end();
    });
    await expect(provider(flaky.url).get("uploads/disease/err.png")).rejects.toThrow(/S3 GET request failed 500/);
    expect(flaky.hits()).toBe(2); // one retry, bounded
  });
});
