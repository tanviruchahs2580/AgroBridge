import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { app, registerFarmer, getAdmin } from "./helpers.js";
import { uploadImage, jpegWithExif, tinyPng } from "./upload-helper.js";

/**
 * AUD-201: the stored photo must be readable by its owner and by an agronomist
 * reviewer, and by nobody else. Before this route existed, `imagePath` was a
 * dead end — no endpoint served the bytes, so the advertised review loop could
 * not practically complete.
 *
 * Byte assertions go through a real HTTP listener + fetch: superagent's
 * response handling re-encoded the image stream as UTF-8 in this environment,
 * which corrupts every byte above 0x7F — exactly the class of bug this test
 * exists to catch, so the test itself must not mask it.
 */
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function fetchImage(token: string | null, caseId: string): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/disease/cases/${caseId}/image`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

async function upload(token: string, data: Buffer, mime: string) {
  const res = await uploadImage(token, data, mime, "photo.jpg");
  expect(res.status).toBe(201);
  return res.body.data as { id: string; imagePath: string };
}

describe("disease case image retrieval (AUD-201)", () => {
  it("serves the exact stored bytes to the owner, with the sniffed content type", async () => {
    const f = await registerFarmer();
    const png = tinyPng();
    const kase = await upload(f.accessToken, png, "image/png");

    const res = await fetchImage(f.accessToken, kase.id);
    expect(res.status).toBe(200);
    expect(String(res.headers.get("content-type"))).toContain("image/png");
    expect(String(res.headers.get("content-disposition"))).toContain("inline");
    expect(String(res.headers.get("cache-control"))).toContain("private");
    // What is served is the stored (already metadata-stripped) file, byte for byte.
    const stored = readFileSync(path.resolve(kase.imagePath));
    const served = Buffer.from(await res.arrayBuffer());
    expect(served.equals(stored)).toBe(true);

    rmSync(path.resolve(kase.imagePath), { force: true });
  });

  it("serves the JPEG's stored bytes (post-EXIF-strip), not the original upload", async () => {
    const f = await registerFarmer();
    const original = jpegWithExif();
    const kase = await upload(f.accessToken, original, "image/jpeg");

    const res = await fetchImage(f.accessToken, kase.id);
    expect(res.status).toBe(200);
    expect(String(res.headers.get("content-type"))).toContain("image/jpeg");
    const served = Buffer.from(await res.arrayBuffer());
    const stored = readFileSync(path.resolve(kase.imagePath));
    expect(served.equals(stored)).toBe(true);
    // The EXIF-bearing original must not be what comes back.
    expect(served.equals(original)).toBe(false);
    expect(served.indexOf(Buffer.from([0xff, 0xe1]))).toBe(-1);

    rmSync(path.resolve(kase.imagePath), { force: true });
  });

  it("gives a non-owner 404 — the endpoint is not an existence oracle", async () => {
    const owner = await registerFarmer();
    const other = await registerFarmer();
    const kase = await upload(owner.accessToken, tinyPng(), "image/png");

    const res = await fetchImage(other.accessToken, kase.id);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
    // And the case metadata stays hidden too, consistently.
    const meta = await fetch(`${baseUrl}/api/v1/disease/cases/${kase.id}`, {
      headers: { Authorization: `Bearer ${other.accessToken}` },
    });
    expect(meta.status).toBe(404);

    rmSync(path.resolve(kase.imagePath), { force: true });
  });

  it("lets a disease:review holder (admin) fetch any case's photo", async () => {
    const f = await registerFarmer();
    const admin = await getAdmin();
    const kase = await upload(f.accessToken, tinyPng(), "image/png");

    const res = await fetchImage(admin.accessToken, kase.id);
    expect(res.status).toBe(200);
    expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);

    rmSync(path.resolve(kase.imagePath), { force: true });
  });

  it("requires authentication and 404s for unknown ids", async () => {
    const f = await registerFarmer();
    const kase = await upload(f.accessToken, tinyPng(), "image/png");

    const anon = await fetchImage(null, kase.id);
    expect(anon.status).toBe(401);

    const missing = await fetchImage(f.accessToken, "00000000-0000-0000-0000-000000000000");
    expect(missing.status).toBe(404);

    rmSync(path.resolve(kase.imagePath), { force: true });
  });
});
