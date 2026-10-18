import { createHash, createHmac } from "node:crypto";
import { StorageProvider } from "./types.js";

/** SHA-256 of the empty payload — canonical hash for bodyless S3 requests. */
const EMPTY_PAYLOAD_SHA256 = createHash("sha256").update("").digest("hex");

/**
 * Minimal S3-compatible storage provider (AWS S3 / Cloudflare R2 / MinIO)
 * implementing SigV4 PUT/DELETE directly on node:crypto — no SDK dependency.
 * Objects are stored under disease/{fileName} and addressed by the same
 * relative path convention as the local provider ("uploads/disease/x").
 */
export class S3StorageProvider implements StorageProvider {
  readonly name = "s3";
  constructor(
    private bucket = process.env.S3_BUCKET ?? "",
    private region = process.env.S3_REGION ?? "auto",
    private accessKey = process.env.S3_ACCESS_KEY_ID ?? "",
    private secretKey = process.env.S3_SECRET_ACCESS_KEY ?? "",
    /** Custom endpoint for R2/MinIO; empty = AWS virtual-hosted style. */
    private endpoint = process.env.S3_ENDPOINT ?? ""
  ) {}

  /** Stored path ("uploads/disease/x") → S3 object key ("disease/x"). */
  private objectKey(key: string): string {
    return key.startsWith("uploads/") ? key.slice("uploads/".length) : key;
  }

  /** SigV4-signed request against the bucket; shared by save and delete. */
  private async signedRequest(method: "PUT" | "DELETE", key: string, body: Buffer): Promise<Response> {
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

    return fetch(url, {
      method,
      headers: {
        Authorization: authorization,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
        ...(method === "PUT" ? { "Content-Type": "application/octet-stream" } : {}),
      },
      body: method === "PUT" ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  }

  async save(fileName: string, data: Buffer): Promise<string> {
    const res = await this.signedRequest("PUT", `disease/${fileName}`, data);
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

  async get(_p: string): Promise<Buffer | null> {
    // Objects are served by the platform CDN/presigner in production; the API
    // never proxies image bytes back (see docs/architecture.md).
    return null;
  }
}
