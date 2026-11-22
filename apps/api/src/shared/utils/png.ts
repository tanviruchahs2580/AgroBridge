/**
 * Dependency-free PNG metadata stripping — the counterpart of jpeg.ts (WP-23,
 * SEC-06). The disease-upload route stored PNG bytes verbatim: a PNG carries
 * the same personal data a JPEG carries in EXIF, in different containers —
 * `eXIf` (the EXIF block itself), `tEXt`/`iTXt`/`zTXt` (arbitrary key/value
 * text: capture tool, GPS tags, user comments), `tIME` (last-modification
 * timestamp).
 *
 * Decisions (mirroring jpeg.ts's):
 *  - the four text containers, `eXIf` and `tIME` are dropped;
 *  - rendering metadata (`iCCP`, `gAMA`, `sRGB`, `pHYs`, `cHRM`) is KEPT:
 *    removing it can visibly shift colours or scale, and it carries no
 *    personal data;
 *  - `IHDR`, `PLTE`, `IDAT`, `IEND` and any ancillary chunk not in the drop
 *    list pass byte-for-byte (CRC included);
 *  - anything that does not parse as a well-formed chunk stream (bad magic,
 *    length past the buffer, non-letter chunk type, missing IEND) throws,
 *    and the caller answers 400 rather than storing bytes it could not clean.
 */

/** Raised when the buffer is not a parseable PNG (caller maps to HTTP 400). */
export class PngMetadataStripError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PngMetadataStripError";
  }
}

/** Chunk types that carry personal or device metadata — dropped on sight. */
const DROPPED_CHUNK_TYPES = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);

function isChunkType(type: Buffer): boolean {
  // PNG chunk type names are 4 strict ASCII letters (PNG spec 5.3).
  for (let i = 0; i < 4; i++) {
    const c = type[i];
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122))) return false;
  }
  return true;
}

/**
 * Returns a copy of a PNG buffer with the metadata chunks removed. Does not
 * mutate the input; returns the input unchanged when there is nothing to drop.
 */
export function stripPngMetadata(input: Buffer): Buffer {
  if (
    input.length < 8 ||
    input[0] !== 0x89 || input[1] !== 0x50 || input[2] !== 0x4e || input[3] !== 0x47 ||
    input[4] !== 0x0d || input[5] !== 0x0a || input[6] !== 0x1a || input[7] !== 0x0a
  ) {
    throw new PngMetadataStripError("missing PNG signature");
  }

  const kept: Buffer[] = [input.subarray(0, 8)];
  let dropped = 0;
  let sawIhdr = false;
  let sawIend = false;
  let i = 8;

  while (i < input.length) {
    if (i + 8 > input.length) throw new PngMetadataStripError(`truncated chunk header at offset ${i}`);
    const length = input.readUInt32BE(i);
    const type = input.subarray(i + 4, i + 8);
    if (!isChunkType(type)) throw new PngMetadataStripError(`non-letter chunk type at offset ${i + 4}`);
    const dataStart = i + 8;
    const chunkEnd = dataStart + length;
    // +4: the CRC that closes every chunk.
    if (chunkEnd + 4 > input.length) throw new PngMetadataStripError(`chunk ${type.toString("latin1")} truncated`);

    const typeStr = type.toString("latin1");
    if (typeStr === "IHDR") sawIhdr = true;
    if (typeStr === "IEND") {
      if (length !== 0) throw new PngMetadataStripError("IEND carries data");
      kept.push(input.subarray(i, chunkEnd + 4));
      sawIend = true;
      i = chunkEnd + 4;
      break;
    }

    if (!DROPPED_CHUNK_TYPES.has(typeStr)) kept.push(input.subarray(i, chunkEnd + 4));
    else dropped++;
    i = chunkEnd + 4;
  }

  if (!sawIhdr) throw new PngMetadataStripError("missing IHDR");
  if (!sawIend) throw new PngMetadataStripError("unterminated PNG (missing IEND)");
  if (i !== input.length) throw new PngMetadataStripError("bytes after IEND");
  if (dropped === 0) return input;
  return Buffer.concat(kept);
}
