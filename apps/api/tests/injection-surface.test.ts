import { describe, expect, it } from "vitest";
import request from "supertest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { app, registerFarmer } from "./helpers.js";
import { primaryOriginOf } from "../src/config/env.js";

/**
 * Injection-surface invariants (B-15) that are cheaper to pin than to review:
 * open-redirect safety of the gateway return, traversal-proof upload naming,
 * and a source scan that forbids the classic sink classes outright. CSV export
 * does not exist in this product, so formula injection has no surface (the
 * scan asserts that too: no csv writer in runtime source).
 */
describe("injection surface (B-15)", () => {
  it("the gateway return redirect always targets the configured web origin, never the request host", () => {
    // The return handler builds `new URL('/orders', primaryWebOrigin)`; the
    // helper must also sanitise a malformed configured list rather than emit
    // it into a Location header.
    expect(primaryOriginOf("https://app.example,https://localhost")).toBe("https://app.example");
    expect(primaryOriginOf("not a url, https://app.example")).toBe("http://localhost:5173");
    expect(primaryOriginOf("")).toBe("http://localhost:5173");
  });

  it("an uploaded filename cannot escape the uploads directory", async () => {
    const f = await registerFarmer();
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64"
    );
    const res = await request(app)
      .post("/api/v1/disease/cases")
      .set("Authorization", `Bearer ${f.accessToken}`)
      .attach("image", png, { filename: "../../evil.png", contentType: "image/png" });
    expect(res.status).toBe(201);
    expect(res.body.data.imagePath).toMatch(/^uploads\/disease\/[0-9a-f-]{36}\.png$/);
    expect(res.body.data.imagePath).not.toContain("..");
  });

  it("runtime source carries no shell/eval/dynamic-deserialization sinks", () => {
    const root = path.resolve("src");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      // Dirent-based walk with an explicit containment barrier: every path
      // opened must resolve INSIDE the scanned source root (an escaping or
      // symlinked entry is skipped). Static analysis can see the guard, and so
      // can a reviewer — the previous join-then-stat shape read whatever the
      // directory listing handed it.
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = path.resolve(dir, entry.name);
        if (!p.startsWith(root + path.sep)) continue;
        if (entry.isDirectory()) walk(p);
        else if (/\.(ts|js)$/.test(entry.name)) {
          const body = readFileSync(p, "utf8");
          for (const [n, line] of body.split("\n").entries()) {
            // `client.eval(...)` is Redis's Lua EVAL command (keys/args bound),
            // not JavaScript eval; a bare `eval(` stays forbidden.
            const jsEval = /(^|[^\w.])eval\s*\(/.test(line);
            if (jsEval || /\bchild_process\b|\bnew Function\s*\(|deserialize\s*\(|\.csv\b/i.test(line)) {
              offenders.push(`${p}:${n + 1}`);
            }
          }
        }
      }
    };
    walk(root);
    expect(offenders, "new sink appeared in runtime source").toEqual([]);
  });
});
