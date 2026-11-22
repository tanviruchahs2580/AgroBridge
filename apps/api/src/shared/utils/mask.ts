/**
 * PII masking for stored metadata and logs (SEC-10).
 *
 * Audit rows are retained for 180 days and readable by operators, so identity
 * fields land in a stable masked form — enough to correlate events, never the
 * raw value. The slice pattern already existed twice (the SMS provider's log
 * mask and the payout-destination mask in payments); this is the one shared
 * definition both now use, and the one the audit call sites use.
 */
export function maskPhone(phone: string): string {
  return `${phone.slice(0, 3)}***${phone.slice(-4)}`;
}

/** `us***@domain.tld` — keeps the domain for correlation, hides the local part. */
export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  return `${local.slice(0, 2)}***${email.slice(at)}`;
}
