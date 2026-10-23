// Bilingual formatting + money conversion helpers.
import type { Lang } from "./i18n";

const CURRENCY_LOCALE: Record<Lang, string> = { bn: "bn-BD", en: "en-GB" };
const DATE_LOCALE: Record<Lang, string> = { bn: "bn-BD", en: "en-GB" };

type DateInput = Date | string | number;

function toDate(d: DateInput): Date {
  return d instanceof Date ? d : new Date(d);
}

/**
 * Format paisa as BDT. Whole taka render without decimals; amounts carrying
 * paisa (e.g. a 3% tier discount) render with 2 decimals. Rounding every line
 * of a breakdown to whole taka independently made displayed line items fail to
 * sum to the displayed total (1,850 − 55.50 + 50 looked like 1,845, not 1,844.50).
 */
/**
 * Format paisa as BDT. Whole taka render without decimals; amounts carrying
 * paisa (e.g. a 3% tier discount) render with 2 decimals. Rounding every line
 * of a breakdown to whole taka independently made displayed line items fail to
 * sum to the displayed total (1,850 − 55.50 + 50 looked like 1,845, not 1,844.50).
 *
 * Two formatters per locale, created once: `Intl.NumberFormat` construction is the
 * expensive part and this runs per price per row — the market grid, the wallet
 * ledger and the admin cards all call it while rendering — on the low-end Android
 * devices this app targets. One instance for whole-taka amounts and one for
 * amounts carrying paisa, because the digit settings differ and the separators are
 * locale-specific (bn-BD has a different decimal mark from en-GB), so a formatted
 * string cannot be post-processed reliably.
 */
const bdtFormatters = new Map<Lang, { whole: Intl.NumberFormat; withPaisa: Intl.NumberFormat }>();

function bdtFormatter(lang: Lang) {
  let pair = bdtFormatters.get(lang);
  if (!pair) {
    pair = {
      whole: new Intl.NumberFormat(CURRENCY_LOCALE[lang], {
        style: "currency",
        currency: "BDT",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }),
      withPaisa: new Intl.NumberFormat(CURRENCY_LOCALE[lang], {
        style: "currency",
        currency: "BDT",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }),
    };
    bdtFormatters.set(lang, pair);
  }
  return pair;
}

export function formatBDT(paisa: number, lang: Lang): string {
  const hasPaisa = paisa % 100 !== 0;
  const { whole, withPaisa } = bdtFormatter(lang);
  return hasPaisa ? withPaisa.format(paisa / 100) : whole.format(Math.floor(paisa / 100));
}

export function formatDate(d: DateInput, lang: Lang): string {
  return new Intl.DateTimeFormat(DATE_LOCALE[lang], { dateStyle: "medium" }).format(toDate(d));
}

export function formatDateTime(d: DateInput, lang: Lang): string {
  return new Intl.DateTimeFormat(DATE_LOCALE[lang], { dateStyle: "medium", timeStyle: "short" }).format(toDate(d));
}

/**
 * Locale tag for `toLocaleDateString`-style calls in components — one source
 * (DATE_LOCALE) instead of `lang === "bn" ? "bn-BD": "en-GB"` at each call site.
 */
export function dateLocale(lang: Lang): string {
  return DATE_LOCALE[lang];
}

export function takaToPaisa(taka: number): number {
  return Math.round(taka * 100);
}

export function paisaToTaka(paisa: number): number {
  return paisa / 100;
}
