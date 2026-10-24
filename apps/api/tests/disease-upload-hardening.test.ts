import { describe, expect, it, vi } from "vitest";
import { readFileSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { registerFarmer } from "./helpers.js";
import { prisma } from "../src/lib/prisma.js";
import { getStorageProvider } from "../src/providers/storage/index.js";
import { stripJpegMetadata, JpegMetadataStripError } from "../src/shared/utils/jpeg.js";
import {
  uploadImage,
  jpegWithExif,
  tinyPng,
  truncatedApp1Jpeg,
  malformedJpeg,
  EXIF_SECRET_MARKER,
} from "./upload-helper.js";

/**
 * B-17: uploaded disease photos must not carry EXIF (GPS/device metadata), and
 * a file stored for a case whose DB insert fails must not be orphaned.
 */
describe("disease upload — EXIF stripping (B-17)", () => {
  it("removes the APP1/EXIF segment from JPEGs before storing", async () => {
    const f = await registerFarmer();
    const res = await uploadImage(f.accessToken, jpegWithExif(), "image/jpeg", "home.jpg");
    expect(res.status).toBe(201);

    const imagePath = res.body.data.imagePath as string;
    const stored = readFileSync(path.resolve(imagePath));
    // APP1 marker (0xFFE1) and the EXIF payload are both absent …
    expect(stored.indexOf(Buffer.from([0xff, 0xe1]))).toBe(-1);
    expect(stored.includes(EXIF_SECRET_MARKER)).toBe(false);
    expect(stored.toString("latin1")).not.toContain("Exif");
    // … while the image itself is intact: SOI, the kept APP0/JFIF segment, SOS.
    expect(stored[0]).toBe(0xff);
    expect(stored[1]).toBe(0xd8);
    expect(stored.indexOf(Buffer.from([0xff, 0xe0]))).toBeGreaterThan(-1);
    expect(stored.indexOf(Buffer.from([0xff, 0xda]))).toBeGreaterThan(-1);
    rmSync(path.resolve(imagePath), { force: true });
  });

  it("stores PNG bytes unchanged (pass-through, documented)", async () => {
    const f = await registerFarmer();
    const png = tinyPng();
    const res = await uploadImage(f.accessToken, png, "image/png", "leaf.png");
    expect(res.status).toBe(201);

    const imagePath = res.body.data.imagePath as string;
    const stored = readFileSync(path.resolve(imagePath));
    expect(stored.equals(png)).toBe(true);
    rmSync(path.resolve(imagePath), { force: true });
  });

  it("rejects malformed JPEGs with 400 instead of storing unverifiable bytes", async () => {
    const f = await registerFarmer();
    for (const bad of [truncatedApp1Jpeg(), malformedJpeg()]) {
      const res = await uploadImage(f.accessToken, bad, "image/jpeg", "broken.jpg");
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    }
    // Nothing was persisted for the rejected uploads.
    const count = await prisma.diseaseCase.count({ where: { userId: f.user.id } });
    expect(count).toBe(0);
  });

  it("stripJpegMetadata unit-level: no APP1 → identical buffer; malformed → throws", () => {
    const png = tinyPng();
    expect(() => stripJpegMetadata(png)).toThrow(JpegMetadataStripError);
    const jpeg = jpegWithExif();
    const cleaned = stripJpegMetadata(jpeg);
    expect(cleaned.equals(jpeg)).toBe(false);
    expect(cleaned.length).toBeLessThan(jpeg.length);
    // Idempotent: a second pass over cleaned bytes changes nothing.
    expect(stripJpegMetadata(cleaned).equals(cleaned)).toBe(true);
  });

  it("deletes the just-stored file when the diseaseCase insert fails (orphan cleanup)", async () => {
    const f = await registerFarmer();
    const provider = getStorageProvider();
    const deleteSpy = vi.spyOn(provider, "delete");
    // Deliberately NOT vi.spyOn(prisma.diseaseCase, "create"): spying on a
    // Prisma model delegate and mockRestore()-ing leaves the delegate's own
    // `create` property deleted, so every later test in the file hit
    // "diseaseCase.create is not a function" (found by AUD-V3, whose WebP
    // test was the first to run after this one). Swapping the function and
    // restoring the same reference keeps the delegate intact.
    const delegate = prisma.diseaseCase as unknown as { create: typeof prisma.diseaseCase.create };
    const originalCreate = delegate.create;
    delegate.create = () => Promise.reject(new Error("simulated DB failure"));
    try {
      const res = await uploadImage(f.accessToken, jpegWithExif(), "image/jpeg", "orphan.jpg");
      expect(res.status).toBe(500);

      expect(deleteSpy).toHaveBeenCalledTimes(1);
      const cleanedKey = deleteSpy.mock.calls[0]![0] as string;
      expect(cleanedKey).toMatch(/^uploads\/disease\/[0-9a-f-]+\.jpg$/);
      // The stored file is actually gone from the uploads dir.
      expect(existsSync(path.resolve(cleanedKey))).toBe(false);
    } finally {
      delegate.create = originalCreate;
      deleteSpy.mockRestore();
    }
  });
});

/**
 * AUD-V3: the magic-byte check must match the FULL format signature. A bare
 * "RIFF" prefix accepted any RIFF container (WAV/AVI) as WebP, and two bytes
 * accepted unrelated streams as PNG — non-image payloads could occupy upload
 * storage disguised as images.
 */
describe("disease upload — deep magic-byte signatures (AUD-V3)", () => {
  it("rejects a RIFF container that is not WebP (WAV payload declared as image/webp)", async () => {
    const f = await registerFarmer();
    // RIFF....WAVE — a valid WAV, not WEBP at bytes 8-12.
    const wav = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0x24, 0x08, 0x00, 0x00]),
      Buffer.from("WAVEfmt ", "ascii"),
      Buffer.alloc(16),
    ]);
    const res = await uploadImage(f.accessToken, wav, "image/webp", "attack.webp");
    expect(res.status).toBe(400);
  });

  it("rejects a two-byte 0x89 0x50 stream that is not a PNG", async () => {
    const f = await registerFarmer();
    const fake = Buffer.concat([Buffer.from([0x89, 0x50]), Buffer.alloc(32, 0xab)]);
    const res = await uploadImage(f.accessToken, fake, "image/png", "attack.png");
    expect(res.status).toBe(400);
  });

  it("accepts a real WebP signature (RIFF….WEBP)", async () => {
    const f = await registerFarmer();
    const webp = Buffer.concat([
      Buffer.from("RIFF", "ascii"),
      Buffer.from([0x24, 0x00, 0x00, 0x00]),
      Buffer.from("WEBPVP8 ", "ascii"),
      Buffer.alloc(24),
    ]);
    const res = await uploadImage(f.accessToken, webp, "image/webp", "leaf.webp");
    expect(res.status).toBe(201);
    const imagePath = res.body.data.imagePath as string;
    rmSync(path.resolve(imagePath), { force: true });
  });

  it("still rejects arbitrary binary", async () => {
    const f = await registerFarmer();
    const res = await uploadImage(f.accessToken, Buffer.from("#!/bin/sh\nrm -rf /\n"), "image/jpeg", "sh.img");
    expect(res.status).toBe(400);
  });
});
