import { hkdfSync } from "node:crypto";

/**
 * Domain-separated key derivation from a root secret (RFC 5869 HKDF).
 *
 * Purpose-bound subkeys so no consumer reuses raw root-secret material in
 * another domain (SEC-03): OTP hashing and login-throttle salting both used
 * JWT_ACCESS_SECRET verbatim, so a compromise or reuse in one domain carried
 * into the others. Deterministic — no stored state, no new env var — and the
 * root secret stays the one artifact rotation manages
 * (docs/runbooks/secret-rotation.md).
 *
 * Deploy note: derived values differ from the raw-secret hashes they replace,
 * so in-flight OTP challenges and login-attempt counters invalidate once at
 * deploy — users re-request a code; throttle counters reset.
 */
export function deriveSubkey(rootSecret: string, info: string, bytes = 32): string {
  return Buffer.from(hkdfSync("sha256", rootSecret, "agrobridge-kdf-salt", info, bytes)).toString("hex");
}
