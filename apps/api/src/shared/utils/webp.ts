/**
 * Dependency-free WebP metadata stripping — the counterpart of jpeg.ts (WP-23,
 * SEC-06). WebP is a RIFF container: the camera's EXIF block travels as the
 * `EXIF` chunk and XMP as `XMP ` (the four-CC ends with a space). The disease
 * upload stored these bytes verbatim, so GPS/device metadata leaked in the
 * format the newer phone cameras actually shoot.
 *
 * Decisions (mirroring jpeg.ts's):
 *  - `EXIF` and `XMP ` chunks are dropped;
 *  - `ICCP` (colour profile) is KEPT — rendering metadata, no personal data;
 *  - the image chunks (`VP8`, `VP8L`, `VP8X`, `ALPH`, animation chunks) pass
 *    byte-for-byte;
 *  - anything that does not parse as a well-formed RIFF/WEBP container throws,
 *    and the caller answers 400 rather than storing bytes it could not clean.
 */

/** Raised when the buffer is not a parseable WebP (caller maps to HTTP 400). */
export class WebpMetadataStripError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebpMetadataStripError";
  }
}

const DROPPED_FOURCCS = new Set(["EXIF", "XMP "]);

/**
 * Returns a copy of a WebP buffer with EXIF/XMP chunks removed. Does not
 * mutate the input; returns the input unchanged when there is nothing to drop.
 */
export function stripWebpMetadata(input: Buffer): Buffer {
  if (
    input.length < 12 ||
    input.toString("latin1", 0, 4) !== "RIFF" ||
    input.toString("latin1", 8, 12) !== "WEBP"
  ) {
    throw new WebpMetadataStripError("missing RIFF/WEBP header");
  }
  const riffSize = input.readUInt32LE(4);
  if (riffSize < 4) throw new WebpMetadataStripError("RIFF size out of bounds");
  // Producers disagree about the RIFF size convention (some include the 8-byte
  // header). Either is accepted; every read stays inside the buffer because the
  // chunk loop bounds against containerEnd, which is clamped to the file.
  const containerEnd = Math.min(8 + riffSize, input.length);

  const kept: Buffer[] = [input.subarray(0, 12)];
  let dropped = 0;
  let i = 12;
  while (i < containerEnd) {
    if (i + 8 > containerEnd) throw new WebpMetadataStripError(`truncated chunk header at offset ${i}`);
    const fourcc = input.toString("latin1", i, i + 4);
    const size = input.readUInt32LE(i + 4);
    const dataStart = i + 8;
    // RIFF chunks pad to even sizes — a single byte after odd payloads.
    const padded = size + (size % 2);
    const chunkEnd = dataStart + padded;
    if (chunkEnd > containerEnd) throw new WebpMetadataStripError(`chunk "${fourcc}" truncated`);

    if (!DROPPED_FOURCCS.has(fourcc)) kept.push(input.subarray(i, chunkEnd));
    else dropped++;
    i = chunkEnd;
  }

  if (dropped === 0) return input;
  return Buffer.concat(kept);
}
