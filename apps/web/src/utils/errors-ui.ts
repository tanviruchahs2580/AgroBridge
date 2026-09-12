// User-facing error mapping: API error codes → bilingual messages,
// always appending the backend support reference when present.
import { ApiError } from "../api/client";
import { t } from "./i18n";
import type { DictKey, Lang } from "./i18n";

/** Mirrors the API zod rule (auth register): BD mobile 01[3-9]XXXXXXXX. */
export const BD_PHONE_RE = /^01[3-9]\d{8}$/;

const CODE_KEYS: Record<string, DictKey> = {
  INVALID_CREDENTIALS: "errInvalidCredentials",
  UNAUTHORIZED: "sessionExpired",
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
 * Code → dictionary key mapping.
 * Known auth errors get dictionary copy; CONFLICT is deliberately _not_
 * pre-mapped because the backend already returns a clear, domain-specific
 * message ("This plot already has an active crop cycle", "Duplicate booking"…).
 * Fallback below uses that server message directly.
 */
const AUTH_CODE_KEYS: Record<string, DictKey> = {
  PHONE_TAKEN: "errPhoneTaken",
  WEAK_PASSWORD: "errWeakPassword",
  PHONE_INVALID: "errPhoneInvalid",
  PHONE_NOT_VERIFIED: "errPhoneNotVerified",
};

/**
 * Map any thrown error to a localized display string.
 *
 * Strategy per HTTP code:
 * - Auth codes (PHONE_TAKEN, WEAK_PASSWORD, etc.) → dictionary copy
 * - CONFLICT → _always_ use the server's domain-specific message
 *   (e.g. "This plot already has an active crop cycle") because a
 *   generic 409 key would be wrong for every non-auth conflict.
 * - VALIDATION_ERROR/BAD_REQUEST/UNPROCESSABLE → try field-level mapping
 *   first; fall back to the server message, then to generic.
 * - 5xx / network → server message when present, else generic.
 *
 * A small-print reference line is appended whenever the envelope carried
 * a support/reference id.
 */
export function mapError(e: unknown, lang: Lang): string {
  const apiErr = e instanceof ApiError ? e : null;
  if (!apiErr) {
    return e instanceof Error && e.message ? e.message : t("errorGeneric", lang);
  }

  // ── Auth-specific code keys ──
  const authKey = AUTH_CODE_KEYS[apiErr.code];
  if (authKey) return `${t(authKey, lang)}${_refLine(lang, apiErr)}`;

  // ── CONFLICT: domain-specific message mapping ──
  if (apiErr.code === "CONFLICT" && apiErr.message) {
    // Normalize the server message for pattern matching
    const msg = apiErr.message;
    const msgLower = msg.toLowerCase();
    // Plot already has an active crop cycle — be crop-specific so we
    // don't catch auth registration errors ("An account … already exists").
    // Only match when the message contains a crop/farm/plot domain keyword
    // alongside the "active" or "already" signal.
    const cropDomain = /plot|crop|farm|field|harvest|seed|plant|planting|cycle|active crop|active cycle/i;
    if ((msgLower.includes("active crop") || msgLower.includes("active cycle")) && cropDomain.test(msg)) {
      return `${t("errActiveCrop", lang)}${_refLine(lang, apiErr)}`;
    }
    // Also catch "plot already has …" or "crop already …" patterns
    if (cropDomain.test(msgLower) && (msgLower.includes("already has") || msgLower.includes("already"))) {
      return `${t("errActiveCrop", lang)}${_refLine(lang, apiErr)}`;
    }
    // Booking conflict (e.g. duplicate service booking)
    if (msgLower.includes("duplicate booking") || msgLower.includes("booking conflict") || msgLower.includes("already booked")) {
      return `${t("errBookingConflict", lang)}${_refLine(lang, apiErr)}`;
    }
    // Cart / stock conflict
    if (msgLower.includes("cart") || msgLower.includes("stock")) {
      return `${t("errCartConflict", lang)}${_refLine(lang, apiErr)}`;
    }
    // Procurement / sale conflict
    if (msgLower.includes("procurement") || msgLower.includes("sale") || msgLower.includes("offer")) {
      return `${t("errOfferConflict", lang)}${_refLine(lang, apiErr)}`;
    }
    // Unknown CONFLICT → use server message directly
    return `${msg}${_refLine(lang, apiErr)}`;
  }

  // ── Validation / unprocessable → try field-level details ──
  if (apiErr.code === "VALIDATION_ERROR" || apiErr.code === "BAD_REQUEST" || apiErr.code === "UNPROCESSABLE") {
    return mapValidationError(apiErr, lang) ?? `${apiErr.message ?? t("errValidation", lang)}${_refLine(lang, apiErr)}`;
  }

  // ── Known generic code keys ──
  const key = CODE_KEYS[apiErr.code];
  if (key) return `${t(key, lang)}${_refLine(lang, apiErr)}`;

  // ── Unknown / server message ──
  return apiErr.message ? `${apiErr.message}${_refLine(lang, apiErr)}` : t("errorGeneric", lang);
}

function _refLine(lang: Lang, err: ApiError): string {
  return err.reference ? `\n${t("referenceLabel", lang)}: ${err.reference}` : "";
}

/** Known backend field names → Bengali display labels. */
const FIELD_LABELS: Record<string, string> = {
  fullName: "পূর্ণ নাম",
  phone: "মোবাইল নম্বর",
  password: "পাসওয়ার্ড",
  confirmPassword: "পাসওয়ার্ড নিশ্চিতকরণ",
  email: "ইমেইল",
  name: "নাম",
  district: "জেলা",
  upazila: "উপজেলা",
  area: "জমির পরিমাণ",
  areaBigha: "জমির পরিমাণ",
  farm: "ফার্ম",
  farmId: "ফার্ম",
  service: "সেবা",
  serviceId: "সেবা",
  plot: "প্লট",
  plotId: "প্লট",
  cropName: "ফসলের নাম",
  crop: "ফসল",
  date: "তারিখ",
  plantedAt: "রোপণের তারিখ",
  scheduledFor: "সময়",
  address: "ঠিকানা",
  deliveryAddress: "ডেলিভারি ঠিকানা",
  amount: "টাকার পরিমাণ",
  qty: "পরিমাণ",
  grade: "মানের গ্রেড",
  qualityGrade: "মানের গ্রেড",
  moisture: "আর্দ্রতা",
  moisturePct: "আর্দ্রতা",
  unit: "একক",
  category: "বিভাগ",
  reason: "কারণ",
  method: "পদ্ধতি",
  destination: "গন্তব্য",
  withdrawalAmount: "উত্তোলনের পরিমাণ",
  provider: "প্রদানকারী",
  providerId: "প্রদানকারী",
};

/**
 * Attempt to render per-field validation errors.
 * Returns null when the error has no field details.
 */
function mapValidationError(err: ApiError, lang: Lang): string | null {
  const details = err.details as Array<{ field?: string; message?: string } | null> | undefined;
  if (!Array.isArray(details) || details.length === 0) return null;

  const fields: Record<string, string> = {};
  for (const d of details) {
    if (!d || !d.field || !d.message) continue;
    // If message already contains Bengali text, use it directly
    const msg = d.message;
    const hasBengali = /[০-৯\u0980-\u09FF]/.test(msg);
    if (!hasBengali) {
      // Map English error message to Bengali
      const mapped = mapValidationMessage(msg, d.field);
      if (mapped) {
        // Use the mapped Bengali message
        const fieldLabel = FIELD_LABELS[d.field] ?? d.field;
        fields[fieldLabel] = mapped;
        continue;
      }
    }
    // Group multiple messages per field
    fields[d.field] = (fields[d.field] ? fields[d.field] + "; " : "") + msg;
  }

  // If there's a single field, show just that field's message
  const keys = Object.keys(fields);
  if (keys.length === 1) {
    return `${t("errFieldRequired", lang)}: ${fields[keys[0]]}`;
  }

  // Multiple fields: list them compactly
  return keys.map((k) => `${k}: ${fields[k]}`).join(" · ");
}

/** Map a common English validation message to Bengali. */
function mapValidationMessage(msg: string, field?: string): string | null {
  const m = msg.toLowerCase();
  if (m.includes("required") || m.includes("must be")) return `${FIELD_LABELS[field ?? ""] ?? field} প্রয়োজন`;
  if (m.includes("invalid") || m.includes("not valid") || m.includes("malformed")) return `${FIELD_LABELS[field ?? ""] ?? field} সঠিক নয়`;
  if (m.includes("too short") || m.includes("less than")) return `${FIELD_LABELS[field ?? ""] ?? field} খুব ছোট`;
  if (m.includes("too long")) return `${FIELD_LABELS[field ?? ""] ?? field} খুব বড়`;
  if (m.includes("must be a number") || m.includes("must be numeric") || m.includes("invalid number")) return `${FIELD_LABELS[field ?? ""] ?? field} সংখ্যা হতে হবে`;
  if (m.includes("must be positive") || m.includes("must be greater than 0")) return `${FIELD_LABELS[field ?? ""] ?? field} শূন্যের বেশি হতে হবে`;
  if (m.includes("must be a valid") && (m.includes("email") || m.includes("url"))) return `${FIELD_LABELS[field ?? ""] ?? field} বৈধ নয়`;
  if (m.includes("duplicate") || m.includes("already")) return `${FIELD_LABELS[field ?? ""] ?? field} ইতিমধ্যে বিদ্যমান`;
  if (m.includes("password")) return "পাসওয়ার্ড সঠিক নয়";
  return null;
}
