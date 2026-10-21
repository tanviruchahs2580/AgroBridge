/**
 * Bangladeshi mobile-number normalisation.
 *
 * The API stores and looks up phone numbers as one canonical string. Before
 * this helper the register schema accepted only ASCII `01[3-9]\d{8}` while
 * login compared the raw request body, so the same human number typed in a
 * different but equally valid way (Bengali numerals ০-৯, a `+880` / `880`
 * country-code prefix, spaces or dashes) either failed validation or silently
 * missed the stored account (the gap).
 *
 * Contract:
 *  - accepts Bengali digits, an optional `+880` / `880` prefix, optional
 *    spaces and dashes;
 *  - output is always the canonical local form `01[3-9]\d{8}` (11 digits);
 *  - returns `null` for anything that cannot be normalised *unambiguously*.
 *    In particular a non-Bangladeshi country code (e.g. `+91…`) is rejected
 *    rather than rewritten into a BD number — normalisation must never turn
 *    one person's phone number into another's.
 */

/** Bengali digits ০-৯, index == ASCII value (U+09E6..U+09EF). */
const BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯";

function toAsciiDigits(input: string): string {
  let out = "";
  for (const ch of input.normalize("NFC")) {
    const idx = BENGALI_DIGITS.indexOf(ch);
    out += idx >= 0 ? String(idx) : ch;
  }
  return out;
}

/**
 * @param input raw user input (unknown so callers can pass anything)
 * @returns canonical `01[3-9]\d{8}` or null when not clearly a BD mobile
 */
export function normalizeBdPhone(input: unknown): string | null {
  if (typeof input !== "string") return null;

  // Formatting-only clean-up: Bengal numerals → ASCII, then spaces/dashes
  // (the separators people actually type). Anything else stays and will fail
  // the final shape check instead of being guessed at.
  const cleaned = toAsciiDigits(input).trim().replace(/[\s-]/g, "");
  if (!cleaned) return null;

  let national: string;
  let hadCountryCode = false;
  if (cleaned.startsWith("+")) {
    // An explicit international prefix: only +880 denotes Bangladesh here.
    if (!cleaned.startsWith("+880")) return null;
    national = cleaned.slice("+880".length);
    hadCountryCode = true;
  } else if (cleaned.startsWith("880") && cleaned.length > 11) {
    // Country code dialled without "+" (8801712345678); an 11-digit local
    // number can never start with 880, so this branch is unambiguous.
    national = cleaned.slice(3);
    hadCountryCode = true;
  } else {
    national = cleaned;
  }

  // Country-code forms are commonly written without the national trunk "0"
  // (+880 1712-345678). Prefixing the trunk zero THERE is unambiguous; a bare
  // 10-digit local form (no country code) is NOT accepted — strict by design,
  // so nothing is ever guessed from an incomplete number.
  if (hadCountryCode && /^1[3-9]\d{8}$/.test(national)) national = `0${national}`;

  return /^01[3-9]\d{8}$/.test(national) ? national : null;
}
