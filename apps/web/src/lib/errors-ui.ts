// User-facing error mapping: API error codes → bilingual messages,
// always appending the backend support reference when present.
import { ApiError } from "./api";
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
  if (!(e instanceof ApiError)) {
    return e instanceof Error && e.message ? e.message : t("errorGeneric", lang);
  }

  // ── Auth-specific code keys ──
  const authKey = AUTH_CODE_KEYS[e.code];
  if (authKey) return `${t(authKey, lang)}${_refLine(lang, e)}`;

  // ── CONFLICT: domain-specific message mapping ──
  if (e.code === "CONFLICT" && e.message) {
    // Normalize the server message for pattern matching
    const msg = e.message;
    const msgLower = msg.toLowerCase();
    // Plot already has an active crop cycle — be crop-specific so we
    // don't catch auth registration errors ("An account … already exists").
    // Only match when the message contains a crop/farm/plot domain keyword
    // alongside the "active" or "already" signal.
    const cropDomain = /plot|crop|farm|field|harvest|seed|plant|planting|cycle|active crop|active cycle/i;
    if ((msgLower.includes("active crop") || msgLower.includes("active cycle")) && cropDomain.test(msg)) {
      return `${t("errActiveCrop", lang)}${_refLine(lang, e)}`;
    }
    // Also catch "plot already has …" or "crop already …" patterns
    if (cropDomain.test(msgLower) && (msgLower.includes("already has") || msgLower.includes("already"))) {
      return `${t("errActiveCrop", lang)}${_refLine(lang, e)}`;
    }
    // Booking conflict (e.g. duplicate service booking)
    if (msgLower.includes("duplicate booking") || msgLower.includes("booking conflict") || msgLower.includes("already booked")) {
      return `${t("errBookingConflict", lang)}${_refLine(lang, e)}`;
    }
    // Cart / stock conflict
    if (msgLower.includes("cart") || msgLower.includes("stock")) {
      return `${t("errCartConflict", lang)}${_refLine(lang, e)}`;
    }
    // Procurement / sale conflict
    if (msgLower.includes("procurement") || msgLower.includes("sale") || msgLower.includes("offer")) {
      return `${t("errOfferConflict", lang)}${_refLine(lang, e)}`;
    }
    // Unknown CONFLICT → use server message directly
    return `${msg}${_refLine(lang, e)}`;
  }

  // ── Validation / unprocessable → try field-level details ──
  if (e.code === "VALIDATION_ERROR" || e.code === "BAD_REQUEST" || e.code === "UNPROCESSABLE") {
    return mapValidationError(e, lang) ?? `${e.message ?? t("errValidation", lang)}${_refLine(lang, e)}`;
  }

  // ── Known generic code keys ──
  const key = CODE_KEYS[e.code];
  if (key) return `${t(key, lang)}${_refLine(lang, e)}`;

  // ── Unknown / server message ──
  return e.message ? `${e.message}${_refLine(lang, e)}` : t("errorGeneric", lang);
}

function _refLine(lang: Lang, err: ApiError): string {
  return err.reference ? `\n${t("referenceLabel", lang)}: ${err.reference}` : "";
}

/** Known backend field names → display labels (both UI languages). */
const FIELD_LABELS: Record<string, { bn: string; en: string }> = {
  fullName: { bn: "পূর্ণ নাম", en: "Full name" },
  phone: { bn: "মোবাইল নম্বর", en: "Mobile number" },
  password: { bn: "পাসওয়ার্ড", en: "Password" },
  confirmPassword: { bn: "নিশ্চিতকরণ", en: "Password confirmation" },
  email: { bn: "ইমেইল", en: "Email" },
  name: { bn: "নাম", en: "Name" },
  district: { bn: "জেলা", en: "District" },
  upazila: { bn: "উপজেলা", en: "Upazila" },
  area: { bn: "জমির পরিমাণ", en: "Land area" },
  areaBigha: { bn: "জমির পরিমাণ", en: "Land area" },
  farm: { bn: "ফার্ম", en: "Farm" },
  farmId: { bn: "ফার্ম", en: "Farm" },
  service: { bn: "সেবা", en: "Service" },
  serviceId: { bn: "সেবা", en: "Service" },
  plot: { bn: "প্লট", en: "Plot" },
  plotId: { bn: "প্লট", en: "Plot" },
  cropName: { bn: "ফসলের নাম", en: "Crop name" },
  crop: { bn: "ফসল", en: "Crop" },
  date: { bn: "তারিখ", en: "Date" },
  plantedAt: { bn: "রোপণের তারিখ", en: "Planting date" },
  scheduledFor: { bn: "সময়", en: "Schedule" },
  address: { bn: "ঠিকানা", en: "Address" },
  deliveryAddress: { bn: "ডেলিভারি ঠিকানা", en: "Delivery address" },
  amount: { bn: "টাকার পরিমাণ", en: "Amount" },
  qty: { bn: "পরিমাণ", en: "Quantity" },
  grade: { bn: "মানের গ্রেড", en: "Quality grade" },
  qualityGrade: { bn: "মানের গ্রেড", en: "Quality grade" },
  moisture: { bn: "আর্দ্রতা", en: "Moisture" },
  moisturePct: { bn: "আর্দ্রতা", en: "Moisture" },
  unit: { bn: "একক", en: "Unit" },
  category: { bn: "বিভাগ", en: "Category" },
  reason: { bn: "কারণ", en: "Reason" },
  method: { bn: "পদ্ধতি", en: "Method" },
  destination: { bn: "গন্তব্য", en: "Destination" },
  withdrawalAmount: { bn: "উত্তোলনের পরিমাণ", en: "Withdrawal amount" },
  provider: { bn: "প্রদানকারী", en: "Provider" },
  providerId: { bn: "প্রদানকারী", en: "Provider" },
};

/** Display label for a backend field name in the active UI language. */
function fieldLabel(field: string | undefined, lang: Lang): string {
  const hit = field ? FIELD_LABELS[field] : undefined;
  return hit ? (lang === "bn" ? hit.bn : hit.en) : field ?? "";
}

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
      // Map English error message into the active UI language
      const mapped = mapValidationMessage(msg, d.field, lang);
      if (mapped) {
        fields[fieldLabel(d.field, lang)] = mapped;
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

/** Map a common English validation message into the active UI language. */
function mapValidationMessage(msg: string, field: string | undefined, lang: Lang): string | null {
  const m = msg.toLowerCase();
  const label = fieldLabel(field, lang);
  if (m.includes("required") || m.includes("must be")) return lang === "bn" ? `${label} প্রয়োজন` : `${label} is required`;
  if (m.includes("invalid") || m.includes("not valid") || m.includes("malformed")) return lang === "bn" ? `${label} সঠিক নয়` : `${label} is invalid`;
  if (m.includes("too short") || m.includes("less than")) return lang === "bn" ? `${label} খুব ছোট` : `${label} is too short`;
  if (m.includes("too long")) return lang === "bn" ? `${label} খুব বড়` : `${label} is too long`;
  if (m.includes("must be a number") || m.includes("must be numeric") || m.includes("invalid number")) return lang === "bn" ? `${label} সংখ্যা হতে হবে` : `${label} must be a number`;
  if (m.includes("must be positive") || m.includes("must be greater than 0")) return lang === "bn" ? `${label} শূন্যের বেশি হতে হবে` : `${label} must be greater than 0`;
  if (m.includes("must be a valid") && (m.includes("email") || m.includes("url"))) return lang === "bn" ? `${label} বৈধ নয়` : `${label} is not valid`;
  if (m.includes("duplicate") || m.includes("already")) return lang === "bn" ? `${label} ইতিমধ্যে বিদ্যমান` : `${label} already exists`;
  if (m.includes("password")) return lang === "bn" ? "পাসওয়ার্ড সঠিক নয়" : "Incorrect password";
  return null;
}
