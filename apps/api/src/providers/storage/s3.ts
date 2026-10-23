import { createHash, createHmac } from "node:crypto";
import { env } from "../../config/env.js";
import { UpstreamHttpError, withResilience } from "../resilience.js";
import { StorageProvider } from "./types.js";

/** SHA-256 of the empty payload — canonical hash for bodyless S3 requests. */
const EMPTY_PAYLOAD_SHA256 = createHash("sha256").update("").digest("hex");

const S3_TIMEOUT_MS = 30_000;

/**
 * Minimal S3-compatible storage provider (AWS S3 / Cloudflare R2 / MinIO)
 * implementing SigV4 PUT/DELETE directly on node:crypto — no SDK dependency.
 * Objects are stored under disease/{fileName} and addressed by the same
 * relative path convention as the local provider ("uploads/disease/x").
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = "s3";
  constructor(
    private bucket = env.S3_BUCKET ?? "",
    private region = env.S3_REGION ?? "auto",
    private accessKey = env.S3_ACCESS_KEY_ID ?? "",
    private secretKey = env.S3_SECRET_ACCESS_KEY ?? "",
    /** Custom endpoint for R2/MinIO; empty = AWS virtual-hosted style. */
    private endpoint = env.S3_ENDPOINT ?? "",
    /** Per-attempt timeout; the production default (30s) unless a caller overrides it (tests inject a tiny one). */
    private timeoutMs: number = S3_TIMEOUT_MS
  ) {}

  /** Stored path ("uploads/disease/x") → S3 object key ("disease/x"). */
  private objectKey(key: string): string {
    return key.startsWith("uploads/") ? key.slice("uploads/".length) : key;
  }

  /** SigV4-signed request against the bucket; shared by save and delete. */
  private async signedRequest(method: "PUT" | "DELETE", key: string, body: Buffer, contentType?: string): Promise<Response> {
    const host = this.endpoint
      ? this.endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "")
      : `${this.bucket}.s3.${this.region}.amazonaws.com`;
    const canonicalUri = this.endpoint ? `/${this.bucket}/${key}` : `/${key}`;
    const url = `${this.endpoint || `https://${host}`}${canonicalUri}`;

    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const dateStamp = amzDate.slice(0, 8);
    // An empty body still signs as the SHA-256 of zero bytes.
    const payloadHash = body.length === 0 ? EMPTY_PAYLOAD_SHA256 : createHash("sha256").update(body).digest("hex");

    const canonicalHeaders =
      `host:${host}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = [method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");

    const hmac = (k: Buffer | string, d: string) => createHmac("sha256", k).update(d).digest();
    const signingKey = hmac(hmac(hmac(hmac(`AWS4${this.secretKey}`, dateStamp), this.region), "s3"), "aws4_request");
    const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

    const authorization =
      `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    // Shared policy: per-attempt timeout, one retry on 5xx/429/network
    // failures — PUT (same key, same bytes) and DELETE (idempotent) are both
    // safe to repeat.
    return withResilience(
      "s3",
      async (signal) => {
        const res = await fetch(url, {
          method,
          headers: {
            Authorization: authorization,
            "x-amz-content-sha256": payloadHash,
            "x-amz-date": amzDate,
            // Content-Type rides unsigned (not in SignedHeaders), so serving
            // the object's real type costs nothing signature-wise. The stored
            // bytes' type must reach the CDN/clients correctly — disease
            // photos are images, not octet streams (AUD-V3 L-4).
            ...(method === "PUT" ? { "Content-Type": contentType ?? "application/octet-stream" } : {}),
          },
          body: method === "PUT" ? new Uint8Array(body) : undefined,
          signal,
        });
        if (!res.ok && (res.status >= 500 || res.status === 429)) {
          throw new UpstreamHttpError(`S3 ${method} request failed ${res.status}`, res.status);
        }
        return res;
      },
      { timeoutMs: this.timeoutMs }
    );
  }

  async save(fileName: string, data: Buffer, mime: string): Promise<string> {
    const res = await this.signedRequest("PUT", `disease/${fileName}`, data, mime);
    if (!res.ok) throw new Error(`S3 upload failed ${res.status}`);

    // Same relative addressing contract as LocalStorageProvider so existing
    // imagePath consumers stay unchanged.
    return `uploads/disease/${fileName}`;
  }

  /**
   * Deletes a stored upload via SigV4 DELETE. A 404 is treated as success:
   * the object is already gone, which is what the caller wants (idempotent
   * deletion, matching LocalStorageProvider's ENOENT tolerance). Any other
   * failure throws — the caller logs it; cleanup never pretends.
   */
  async delete(key: string): Promise<void> {
    const res = await this.signedRequest("DELETE", this.objectKey(key), Buffer.alloc(0));
    if (!res.ok && res.status !== 404) throw new Error(`S3 delete failed ${res.status}`);
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- async by storage contract; objects are served by the CDN, so there is no I/O here.
  async get(_p: string): Promise<Buffer | null> {
    // Objects are served by the platform CDN/presigner in production; the API
    // never proxies image bytes back (see docs/architecture.md).
    return null;
  }
}
