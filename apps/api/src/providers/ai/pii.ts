/**
 * Outbound PII redaction for model-bound text.
 *
 * The hosted provider is a third party: a phone number, NID or email a farmer
 * types into a question must not be forwarded (audit P3; `AGENTS.md` §13
 * "send the minimum necessary data"). The project had no content-level outbound
 * redactor — `LOG_REDACT_PATHS` is field-name based and covers the log stream
 * only — so this module is the AI path's redactor. It is deliberately narrow
 * and deterministic: recognised identifiers are replaced with typed
 * placeholders, and nothing else is rewritten, so the agronomy intent of the
 * question survives.
 *
 * The original question is still persisted on the owner-scoped advisory row
 * (`AdvisoryQuery`); only the text sent to the third-party model is redacted.
 *
 * Both ASCII and Bengali digits are handled: a farmer may well type
 * "০১৭১২৩৪৫৬৭৮", and a guard that only reads `\d` would miss it.
 */
const BD_PHONE_RE = /(?:\+?880|0)1[3-9]\d{8}(?!\d)/g;
const BD_PHONE_BN_RE = /(?:\+?৮৮০|০)১[৩-৯][০-৯]{8}(?![০-৯])/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/**
 * Standalone digit runs that look like identifiers: NID (10/13/17 digits) and
 * bank/account numbers (12–19). The phone patterns run first, so an 11-digit
 * phone is already replaced and cannot be re-matched here.
 */
const ID_NUMBER_RE = /(?<!\d)\d{10,19}(?!\d)/g;
const ID_NUMBER_BN_RE = /(?<![০-৯])[০-৯]{10,19}(?![০-৯])/g;

export function redactOutboundPii(text: string): string {
  return text
    .replace(BD_PHONE_RE, "[redacted-phone]")
    .replace(BD_PHONE_BN_RE, "[redacted-phone]")
    .replace(EMAIL_RE, "[redacted-email]")
    .replace(ID_NUMBER_RE, "[redacted-number]")
    .replace(ID_NUMBER_BN_RE, "[redacted-number]");
}
