import { createHash, createHmac } from "node:crypto";
import { StorageProvider } from "./types.js";

/**
 * Minimal S3-compatible storage provider (AWS S3 / Cloudflare R2 / MinIO)
 * implementing SigV4 PUT directly on node:crypto — no SDK dependency.
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

  async save(fileName: string, data: Buffer): Promise<string> {
    const key = `disease/${fileName}`;
    const host = this.endpoint
      ? this.endpoint.replace(/^https?:\/\//, "").replace(/\/$/, "")
      : `${this.bucket}.s3.${this.region}.amazonaws.com`;
    const canonicalUri = this.endpoint ? `/${this.bucket}/${key}` : `/${key}`;
    const url = `${this.endpoint || `https://${host}`}${canonicalUri}`;

    const now = new Date();
    const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = createHash("sha256").update(data).digest("hex");

    const canonicalHeaders =
      `host:${host}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = [
      "PUT",
      canonicalUri,
      "",
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

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

    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: authorization,
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
        "Content-Type": "application/octet-stream",
      },
      body: new Uint8Array(data),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`S3 upload failed ${res.status}`);

    // Same relative addressing contract as LocalStorageProvider so existing
    // imagePath consumers stay unchanged.
    return `uploads/disease/${fileName}`;
  }

  async get(_p: string): Promise<Buffer | null> {
    // Objects are served by the platform CDN/presigner in production; the API
    // never proxies image bytes back (see docs/architecture.md).
    return null;
  }
}
