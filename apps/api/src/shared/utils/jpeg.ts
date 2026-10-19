/**
 * Dependency-free JPEG metadata stripping.
 *
 * Photos taken on phones carry an APP1 segment holding EXIF: GPS coordinates,
 * device model/serial and timestamps. The disease-upload route validated magic
 * bytes and size but stored the bytes verbatim, so a farmer's home GPS
 * coordinates travelled with every crop photo. This stripper walks the JPEG
 * marker segments and drops APP1 before the image is written to storage.
 *
 * Decisions:
 *  - APP1 (EXIF *and* XMP — both are APP1) is dropped;
 *  - APP2 (ICC colour profile) is KEPT: it is rendering metadata, carries no
 *    personal data, and removing it can visibly shift colours on wide-gamut
 *    devices;
 *  - APP0 (JFIF) and all structural segments (SOF/DQT/DHT/SOS…) are kept
 *    byte-for-byte;
 *  - anything that does not parse as a well-formed JPEG segment stream throws,
 *    and the caller answers 400 rather than storing bytes it could not clean.
 */

/** Raised when the buffer is not a parseable JPEG (caller maps to HTTP 400). */
export class JpegMetadataStripError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JpegMetadataStripError";
  }
}

/**
 * Returns a copy of a JPEG buffer with APP1 (EXIF/XMP) segments removed.
 * Does not mutate the input; returns the input buffer unchanged when there is
 * nothing to drop.
 */
export function stripJpegMetadata(input: Buffer): Buffer {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) {
    throw new JpegMetadataStripError("missing JPEG SOI");
  }

  const kept: Buffer[] = [input.subarray(0, 2)]; // SOI (FFD8)
  let dropped = 0;
  let reachedScanOrEnd = false;
  let i = 2;

  while (i < input.length) {
    if (input[i] !== 0xff) throw new JpegMetadataStripError(`expected marker at offset ${i}`);

    // Markers may be preceded by fill bytes (FF FF … FF <marker>).
    const markerStart = i;
    while (i < input.length && input[i] === 0xff) i++;
    if (i >= input.length) throw new JpegMetadataStripError("truncated after fill byte");
    const marker = input[i]!;
    i++;

    if (marker === 0xd9 || marker === 0xda) {
      // EOI, or SOS whose entropy-coded scan runs to EOI with no segment
      // length: copy this marker and everything after it untouched.
      kept.push(input.subarray(markerStart));
      reachedScanOrEnd = true;
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      // Standalone markers (TEM / RSTn) carry no length field.
      kept.push(input.subarray(markerStart, i));
      continue;
    }

    if (i + 2 > input.length) throw new JpegMetadataStripError("truncated segment length");
    const segmentLength = input.readUInt16BE(i);
    if (segmentLength < 2) throw new JpegMetadataStripError("invalid segment length");
    const segmentEnd = i + segmentLength;
    if (segmentEnd > input.length) throw new JpegMetadataStripError("truncated segment body");

    // APP1 = EXIF or XMP (device/GPS metadata) — dropped. APP2 (ICC) and other
    // APPn segments are kept (see file header).
    if (marker !== 0xe1) kept.push(input.subarray(markerStart, segmentEnd));
    else dropped++;

    i = segmentEnd;
  }

  if (!reachedScanOrEnd) throw new JpegMetadataStripError("unterminated JPEG (missing SOS/EOI)");
  if (dropped === 0) return input;
  return Buffer.concat(kept);
}
