/**
 * Queueability rules, extracted from offlineQueue (AUD-V3): the API client's
 * failure path consults these from inside its own module evaluation, and the
 * queue itself is a dependency-heavy module (api ↔ sessionManager ↔ i18n).
 * A rules module with NO imports cannot sit in anyone's TDZ, whatever
 * evaluation order a bundler or test runner picks.
 */

/**
 * Endpoints that must never be replayed blind. A checkout is not idempotent:
 * replaying a queued attempt after the user retried manually creates a second
 * order and decrements stock twice, so it stays out even though it lives under
 * /orders.
 */
export const NEVER_QUEUE = ["/orders/checkout"];

/**
 * Methods that change server state and are therefore the only ones worth
 * replaying. A failed GET is a read, not a pending change: replaying it later
 * would send a stale request as if it were a mutation and would inflate the
 * user-facing queue badge for work no one ever asked to retry.
 */
export const QUEUEABLE_METHODS = new Set(["POST", "PATCH", "DELETE"]);

/**
 * Allow-list: state-changing requests to farm events, cart, and orders sync
 * endpoints. Method-aware (WEB-4): reads (`GET`/`HEAD`/…) are never queued.
 */
export function isQueueable(method: string, url: string): boolean {
  if (!QUEUEABLE_METHODS.has(method.toUpperCase())) return false;
  if (NEVER_QUEUE.some((p) => url.includes(p))) return false;
  return url.includes("/events") || url.includes("/cart") || url.includes("/orders");
}
