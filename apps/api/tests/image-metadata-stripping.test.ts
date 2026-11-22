import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { rmSync } from "node:fs";
import path from "node:path";
import { registerFarmer } from "./helpers.js";
import { stripPngMetadata, PngMetadataStripError } from "../src/shared/utils/png.js";
import { stripWebpMetadata, WebpMetadataStripError } from "../src/shared/utils/webp.js";
import {
  uploadImage,
  pngWithText,
  webpWithExif,
  truncatedPngChunk,
  truncatedWebpChunk,
  tinyPng,
  PNG_SECRET_MARKER,
  EXIF_SECRET_MARKER,
} from "./upload-helper.js";

/**
 * WP-23 / SEC-06 (second half): the JPEG EXIF stripper shipped in the B-17
 * remediation, but PNG and WebP bytes were stored verbatim — the same GPS /
 * device data in each format's own container (`eXIf`/`tEXt`/`tIME` chunks,
 * RIFF `EXIF`/`XMP ` chunks). The strippers here are dependency-free chunk
 * walkers with strict bounds; the fuzz properties assert the only two legal
 * outcomes for arbitrary input: a clean parse with the dropped chunk types
 * absent, or a typed error the route maps to 400.
 */
describe("PNG metadata stripping", () => {
  it("drops tEXt/eXIf/tIME chunks and keeps image + rendering chunks", () => {
    const png = pngWithText();
    const cleaned = stripPngMetadata(png);
    expect(cleaned.toString("latin1")).not.toContain(PNG_SECRET_MARKER);
    expect(cleaned.includes(Buffer.from("tEXt", "latin1"))).toBe(false);
    expect(cleaned.includes(Buffer.from("IHDR", "latin1"))).toBe(true);
    expect(cleaned.includes(Buffer.from("IEND", "latin1"))).toBe(true);
    expect(cleaned.length).toBeLessThan(png.length);
    // Idempotent: a second pass changes nothing.
    expect(stripPngMetadata(cleaned).equals(cleaned)).toBe(true);
  });

  it("returns the input unchanged when there is nothing to drop", () => {
    expect(stripPngMetadata(tinyPng()).equals(tinyPng())).toBe(true);
  });

  it("rejects truncation, non-letter chunk types and bytes after IEND", () => {
    expect(() => stripPngMetadata(Buffer.from([0x89, 0x50]))).toThrow(PngMetadataStripError);
    expect(() => stripPngMetadata(truncatedPngChunk())).toThrow(PngMetadataStripError);
    const badType = Buffer.from(tinyPng());
    Buffer.from("IEND", "latin1").copy(badType, tinyPng().length - 12);
    badType.write("1END", tinyPng().length - 12, "latin1");
    expect(() => stripPngMetadata(badType)).toThrow(PngMetadataStripError);
  });
});

describe("WebP metadata stripping", () => {
  it("drops EXIF and XMP chunks and keeps image chunks", () => {
    const webp = webpWithExif();
    const cleaned = stripWebpMetadata(webp);
    expect(cleaned.includes(EXIF_SECRET_MARKER)).toBe(false);
    expect(cleaned.includes(Buffer.from("EXIF", "latin1"))).toBe(false);
    expect(cleaned.includes(Buffer.from("VP8L", "latin1"))).toBe(true);
    expect(cleaned.length).toBeLessThan(webp.length);
    expect(stripWebpMetadata(cleaned).equals(cleaned)).toBe(true);
  });

  it("rejects a bad header and a chunk that claims past the container", () => {
    expect(() => stripWebpMetadata(Buffer.from("RIFF0000JPEG"))).toThrow(WebpMetadataStripError);
    expect(() => stripWebpMetadata(truncatedWebpChunk())).toThrow(WebpMetadataStripError);
  });
});

describe("stripper fuzz properties (arbitrary byte input)", () => {
  it("PNG: any input either throws the typed error or strips to a parseable, marker-free PNG", () => {
    const arb = fc.uint8Array({ minLength: 8, maxLength: 512 });
    fc.assert(
      fc.property(arb, (bytes) => {
        const input = Buffer.from(bytes);
        let out: Buffer;
        try {
          out = stripPngMetadata(input);
        } catch (e) {
          expect(e).toBeInstanceOf(PngMetadataStripError);
          return;
        }
        // A successful strip must itself parse (idempotence) and carry none of
        // the dropped chunk types.
        expect(stripPngMetadata(out).equals(out)).toBe(true);
        for (const t of ["tEXt", "iTXt", "zTXt", "tIME", "eXIf"]) {
          expect(out.includes(Buffer.from(t, "latin1"))).toBe(false);
        }
      }),
      { numRuns: 300 }
    );
  });

  it("WebP: any input either throws the typed error or strips to a parseable, marker-free WebP", () => {
    const arb = fc.uint8Array({ minLength: 12, maxLength: 512 });
    fc.assert(
      fc.property(arb, (bytes) => {
        const input = Buffer.from(bytes);
        let out: Buffer;
        try {
          out = stripWebpMetadata(input);
        } catch (e) {
          expect(e).toBeInstanceOf(WebpMetadataStripError);
          return;
        }
        expect(stripWebpMetadata(out).equals(out)).toBe(true);
        expect(out.includes(Buffer.from("EXIF", "latin1"))).toBe(false);
        expect(out.includes(Buffer.from("XMP ", "latin1"))).toBe(false);
      }),
      { numRuns: 300 }
    );
  });
});

describe("disease upload routes strip PNG/WebP metadata before storing", () => {
  it("a PNG with a tEXt secret is stored without it", async () => {
    const f = await registerFarmer();
    const res = await uploadImage(f.accessToken, pngWithText(), "image/png", "leaf.png");
    expect(res.status).toBe(201);
    const stored = (await import("node:fs")).readFileSync(path.resolve(res.body.data.imagePath as string));
    expect(stored.toString("latin1")).not.toContain(PNG_SECRET_MARKER);
    expect(stored.includes(Buffer.from("IHDR", "latin1"))).toBe(true);
    rmSync(path.resolve(res.body.data.imagePath as string), { force: true });
  });

  it("a WebP with an EXIF secret is stored without it", async () => {
    const f = await registerFarmer();
    const res = await uploadImage(f.accessToken, webpWithExif(), "image/webp", "leaf.webp");
    expect(res.status).toBe(201);
    const stored = (await import("node:fs")).readFileSync(path.resolve(res.body.data.imagePath as string));
    expect(stored.includes(EXIF_SECRET_MARKER)).toBe(false);
    rmSync(path.resolve(res.body.data.imagePath as string), { force: true });
  });

  it("malformed PNG/WebP containers answer 400 and persist nothing", async () => {
    const f = await registerFarmer();
    for (const [bad, mime] of [
      [truncatedPngChunk(), "image/png"],
      [truncatedWebpChunk(), "image/webp"],
    ] as const) {
      const res = await uploadImage(f.accessToken, bad, mime, "broken.img");
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Malformed (png|webp)/);
    }
    const count = await prisma0(f);
    expect(count).toBe(0);
  });
});

/** The cases table above shares one farmer; counting after all attempts. */
async function prisma0(f: Awaited<ReturnType<typeof registerFarmer>>): Promise<number> {
  const { prisma } = await import("../src/lib/prisma.js");
  return prisma.diseaseCase.count({ where: { userId: f.user.id } });
}
