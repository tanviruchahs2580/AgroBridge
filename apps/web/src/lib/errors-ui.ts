// User-facing error mapping: API error codes → bilingual messages,
// always appending the backend support reference when present.
import { ApiError } from "./api.js";
import { t } from "./i18n.js";
import type { DictKey, Lang } from "./i18n.js";

/** Mirrors the API zod rule (auth register): BD mobile 01[3-9]XXXXXXXX. */
export const BD_PHONE_RE = /^01[3-9]\d{8}$/;

const CODE_KEYS: Record<string, DictKey> = {
  INVALID_CREDENTIALS: "errInvalidCredentials",
  UNAUTHORIZED: "sessionExpired",
  CONFLICT: "errPhoneTaken",
  VALIDATION_ERROR: "errValidation",
  BAD_REQUEST: "errValidation",
  UNPROCESSABLE: "errValidation",
  FORBIDDEN: "errForbidden",
  PHONE_NOT_VERIFIED: "errPhoneNotVerified",
  NOT_FOUND: "errNotFoundGeneric",
  RATE_LIMITED: "errRateLimited",
  INSUFFICIENT_STOCK: "errInsufficientStock",
  INSUFFICIENT_BALANCE: "errInsufficientBalance",
  NETWORK_ERROR: "errNetwork",
  NETWORK_TIMEOUT: "errNetwork",
  BAD_RESPONSE: "errNetwork",
};

/**
 * Map any thrown error to a localized display string.
 * Known ApiError codes use dictionary copy; unknown codes fall back to the
 * server message; non-API errors use the generic copy. A small-print
 * reference line is appended whenever the envelope carried one.
 */
export function mapError(e: unknown, lang: Lang): string {
  let msg: string;
  if (e instanceof ApiError) {
    const key = CODE_KEYS[e.code];
    msg = key ? t(key, lang) : e.message || t("errorGeneric", lang);
  } else if (e instanceof Error && e.message) {
    msg = e.message;
  } else {
    msg = t("errorGeneric", lang);
  }
  const ref = e instanceof ApiError && e.reference ? `\n${t("referenceLabel", lang)}: ${e.reference}` : "";
  return `${msg}${ref}`;
}
