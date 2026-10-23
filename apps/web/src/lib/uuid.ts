/**
 * Idempotency tokens and request ids, generated once, safely, in one place.
 *
 * Three copies of this existed: `lib/api.ts` (request ids), `lib/offlineQueue.ts`
 * (queue entry ids) and `features/marketplace/Market.tsx` (the checkout idempotency
 * key). The first two carried the full posture below; the third called
 * `crypto.randomUUID()` directly — and it did so **before** its `try`, so on any
 * context without `randomUUID` (plain-HTTP dev hosts, WebViews older than Chrome 92)
 * the throw skipped the `setPlacing(false)` in `finally` and the "Place order"
 * button spun forever with no error and no way out. One definition, one posture.
 *
 * `Math.random` is deliberately never used: these values are idempotency tokens, and
 * a guessable or colliding token is the difference between one order and two.
 */
let fallbackCounter = 0;

function randomHex32(): string | null {
  const c = globalThis.crypto as Crypto | undefined;
  if (typeof c?.getRandomValues !== "function") return null;
  const bytes = c.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // variant 10
  const hex = Array.from(bytes, (b: number) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * A v4 UUID when WebCrypto is available, a monotonic timestamp+counter when it is
 * not. Never throws, so a caller can use it inline without its own guard.
 */
export function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  return randomHex32() ?? `${Date.now().toString(36)}-${(fallbackCounter++).toString(36)}`;
}

/** Correlation id for one logical request (kept across that request's retries). */
export function newRequestId(): string {
  return uuid();
}
