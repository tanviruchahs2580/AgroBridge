import { randomUUID } from "node:crypto";
import request from "supertest";
import { app } from "./helpers.js";

/**
 * Shared multipart/JPEG fixtures for the disease-upload tests (B-17 / B-24).
 * Kept out of *.test.ts so vitest does not pick it up as a suite.
 */

type Field = { name: string; value: string };
type File = { name: string; mime: string; filename: string; data: Buffer };

export function multipartBody(parts: Array<Field | File>): { boundary: string; body: Buffer } {
  const boundary = `----agrobridgeTest${randomUUID().replace(/-/g, "")}`;
  const chunks: Buffer[] = [];
  for (const part of parts) {
    if ("value" in part) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`));
    } else {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.mime}\r\n\r\n`
        )
      );
      chunks.push(part.data);
      chunks.push(Buffer.from("\r\n"));
    }
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}

/** Uploads an image through the real disease endpoint. */
export function uploadImage(token: string, data: Buffer, mime: string, filename = "photo.img", extra: Field[] = []) {
  const { boundary, body } = multipartBody([{ name: "image", mime, filename, data }, ...extra]);
  return request(app)
    .post("/api/v1/disease/cases")
    .set("Authorization", `Bearer ${token}`)
    .set("Content-Type", `multipart/form-data; boundary=${boundary}`)
    .send(body);
}

function segment(marker: number, payload: Buffer): Buffer {
  const len = Buffer.alloc(2);
  len.writeUInt16BE(payload.length + 2);
  return Buffer.concat([Buffer.from([0xff, marker]), len, payload]);
}

/** Marker text that must NOT survive EXIF stripping. */
export const EXIF_SECRET_MARKER = "AGROBRIDGE_EXIF_SECRET_MARKER";

/**
 * Minimal well-formed JPEG: SOI + APP0(JFIF) + APP1(EXIF w/ secret marker)
 * + SOS + short scan + EOI.
 */
export function jpegWithExif(): Buffer {
  const soi = Buffer.from([0xff, 0xd8]);
  const app0 = segment(0xe0, Buffer.from("JFIF\0\x01\x02\0\0\x01\0\x01\0\0", "latin1"));
  const exifPayload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), Buffer.from(EXIF_SECRET_MARKER, "latin1")]);
  const app1 = segment(0xe1, exifPayload);
  // SOS header (length 8: 1 component, id 1, table 0, Ss/Se/AhAl 0,63,0),
  // then a tiny entropy-coded scan and EOI.
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]);
  const scanAndEoi = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xff, 0xd9]);
  return Buffer.concat([soi, app0, app1, sos, scanAndEoi]);
}

/** Minimal PNG (signature + IHDR + IEND) — passes magic-byte validation. */
export function tinyPng(): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x0d]),
    Buffer.from("IHDR"),
    Buffer.alloc(13),
    Buffer.from([0x7a, 0x9d, 0x23, 0x4f]),
  ]);
  const iend = Buffer.concat([Buffer.from([0, 0, 0, 0]), Buffer.from("IEND"), Buffer.from([0xae, 0x42, 0x60, 0x82])]);
  return Buffer.concat([sig, ihdr, iend]);
}

/** JPEG whose APP1 segment claims more bytes than the buffer holds. */
export function truncatedApp1Jpeg(): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x40]), Buffer.from("Exif\0\0short", "latin1")]);
}

/** JPEG whose segment stream is malformed right after SOI (0x00 ≠ 0xFF). */
export function malformedJpeg(): Buffer {
  return Buffer.from([0xff, 0xd8, 0x00, 0x11, 0x22, 0x33, 0x44]);
}

/** PNG CRC32 (the checksum the format requires on every chunk). */
function pngCrc(type: Buffer, data: Buffer): Buffer {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of Buffer.concat([type, data])) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  crc = (crc ^ 0xffffffff) >>> 0;
  const out = Buffer.alloc(4);
  out.writeUInt32BE(crc >>> 0);
  return out;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, "latin1");
  return Buffer.concat([len, typeBuf, data, pngCrc(typeBuf, data)]);
}

/** Marker text that must NOT survive PNG metadata stripping. */
export const PNG_SECRET_MARKER = "AGROBRIDGE_PNG_TEXT_SECRET";

/** Minimal PNG with IHDR + a tEXt chunk carrying a secret + IEND. */
export function pngWithText(): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = pngChunk("IHDR", Buffer.alloc(13));
  const text = pngChunk("tEXt", Buffer.concat([Buffer.from("Comment\0", "latin1"), Buffer.from(PNG_SECRET_MARKER, "latin1")]));
  const iend = pngChunk("IEND", Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, text, iend]);
}

/** PNG whose tEXt chunk claims more bytes than the buffer holds. */
export function truncatedPngChunk(): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = pngChunk("IHDR", Buffer.alloc(13));
  const bogus = Buffer.alloc(4);
  bogus.writeUInt32BE(0x00100000);
  return Buffer.concat([sig, ihdr, bogus, Buffer.from("tEXt"), Buffer.from("short", "latin1")]);
}

/** WebP whose EXIF chunk carries a secret marker (RIFF + VP8X-less minimal). */
export function webpWithExif(): Buffer {
  const vp8l = Buffer.concat([
    Buffer.from("VP8L", "latin1"),
    (() => {
      const len = Buffer.alloc(4);
      len.writeUInt32LE(5);
      return len;
    })(),
    // A tiny (invalid-as-pixels but structurally present) VP8L payload.
    Buffer.from([0x10, 0x14, 0x00, 0x00, 0x00]),
    Buffer.from([0x00]), // odd-size pad byte
  ]);
  const exifPayload = Buffer.from(EXIF_SECRET_MARKER, "latin1");
  const exif = Buffer.concat([
    Buffer.from("EXIF", "latin1"),
    (() => {
      const len = Buffer.alloc(4);
      len.writeUInt32LE(exifPayload.length);
      return len;
    })(),
    exifPayload,
    Buffer.from([0x00]), // pad byte (payload is odd-length)
  ]);
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), vp8l, exif]);
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from("RIFF", "latin1"), riffSize, body]);
}

/** WebP whose EXIF chunk header claims more bytes than the container holds. */
export function truncatedWebpChunk(): Buffer {
  const vp8l = Buffer.concat([
    Buffer.from("VP8L", "latin1"),
    (() => {
      const len = Buffer.alloc(4);
      len.writeUInt32LE(5);
      return len;
    })(),
    Buffer.from([0x10, 0x14, 0x00, 0x00, 0x00]),
    Buffer.from([0x00]),
  ]);
  const exifHeader = Buffer.concat([Buffer.from("EXIF", "latin1"), (() => {
    const len = Buffer.alloc(4);
    len.writeUInt32LE(0x00100000);
    return len;
  })(), Buffer.from("short", "latin1")]);
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), vp8l, exifHeader]);
  const riffSize = Buffer.alloc(4);
  riffSize.writeUInt32LE(body.length);
  return Buffer.concat([Buffer.from("RIFF", "latin1"), riffSize, body]);
}
