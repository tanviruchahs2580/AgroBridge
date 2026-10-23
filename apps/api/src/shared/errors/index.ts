export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, "BAD_REQUEST", msg, details);
export const unauthorized = (msg = "Authentication required") => new AppError(401, "UNAUTHORIZED", msg);
/**
 * A 401 that means "these credentials are wrong", not "your session ended".
 * The web app maps the codes separately (INVALID_CREDENTIALS → "wrong number
 * or password"; UNAUTHORIZED → "session expired"), so using the generic one on
 * the login route told failed logins their session had expired (found live
 * 2026-10-19; the INVALID_CREDENTIALS mapping had never had a producer).
 */
export const invalidCredentials = (msg = "Invalid credentials") => new AppError(401, "INVALID_CREDENTIALS", msg);
export const forbidden = (msg = "You do not have permission to perform this action") =>
  new AppError(403, "FORBIDDEN", msg);
export const notFound = (entity = "Resource") => new AppError(404, "NOT_FOUND", `${entity} not found`);
export const conflict = (msg: string) => new AppError(409, "CONFLICT", msg);
export const unprocessable = (msg: string, details?: unknown) => new AppError(422, "UNPROCESSABLE", msg, details);
export const tooMany = (msg = "Too many requests, please try again later") =>
  new AppError(429, "RATE_LIMITED", msg);
/**
 * Per-account login lock (accountThrottle). Keyed by a hash of the phone, so
 * it fires for unknown numbers too — the message must never reveal whether the
 * account exists.
 */
export const accountLocked = (msg = "Too many failed attempts for this account. Try again in a few minutes.") =>
  new AppError(429, "ACCOUNT_LOCKED", msg);
/** Password-reset OTP rejected: the code was wrong (attempt counted).*/
export const otpInvalid = (msg = "Incorrect verification code") => new AppError(400, "OTP_INVALID", msg);
/** Password-reset OTP missing, consumed, expired or out of attempts.*/
export const otpExpired = (msg = "Verification code expired or not found. Request a new one.") =>
  new AppError(400, "OTP_EXPIRED", msg);
export const phoneNotVerified = () =>
  new AppError(403, "PHONE_NOT_VERIFIED", "Phone number must be verified before this action");
export const serviceUnavailable = (msg: string, details?: unknown) =>
  new AppError(503, "SERVICE_UNAVAILABLE", msg, details);

/**
 * No real payment gateway is configured, so money cannot move. Returned instead
 * of simulating a successful payment: an order must never be reported as paid
 * when nothing was collected. The client shows "order placed, payment pending".
 */
export const paymentGatewayUnconfigured = () =>
  new AppError(
    503,
    "PAYMENT_GATEWAY_NOT_CONFIGURED",
    "Payment gateway is not configured on this deployment; the order is saved and remains unpaid"
  );

/** The configured gateway could not be reached — retryable, nothing was charged. */
export const paymentGatewayUnavailable = (details?: unknown) =>
  new AppError(502, "PAYMENT_GATEWAY_UNAVAILABLE", "Payment gateway is temporarily unavailable; nothing was charged", details);

/**
 * A weather provider failed after the retry policy was exhausted. Explicit
 * 502 (not a generic 500): the failure is upstream, the client may retry, and
 * the service never substitutes a fabricated forecast (AUD-V3 — the deferred
 * improvement in modules/weather/routes.ts, now done).
 */
export const weatherProviderUnavailable = (details?: unknown) =>
  new AppError(502, "WEATHER_PROVIDER_UNAVAILABLE", "Weather service is temporarily unavailable; please retry shortly", details);

/** Refused by our own resilience policy (circuit open / bulkhead full) — 503. */
export const weatherProviderOverloaded = (details?: unknown) =>
  new AppError(503, "WEATHER_PROVIDER_OVERLOADED", "Weather service is temporarily overloaded; please retry later", details);
