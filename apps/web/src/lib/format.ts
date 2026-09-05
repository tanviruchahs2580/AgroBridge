// Bilingual formatting + money conversion helpers.
import type { Lang } from "./i18n.js";

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
export function formatBDT(paisa: number, lang: Lang): string {
  const hasPaisa = paisa % 100 !== 0;
  return new Intl.NumberFormat(CURRENCY_LOCALE[lang], {
    style: "currency",
    currency: "BDT",
    minimumFractionDigits: hasPaisa ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(paisa / 100);
}

export function formatDate(d: DateInput, lang: Lang): string {
  return new Intl.DateTimeFormat(DATE_LOCALE[lang], { dateStyle: "medium" }).format(toDate(d));
}

export function formatDateTime(d: DateInput, lang: Lang): string {
  return new Intl.DateTimeFormat(DATE_LOCALE[lang], { dateStyle: "medium", timeStyle: "short" }).format(toDate(d));
}

export function takaToPaisa(taka: number): number {
  return Math.round(taka * 100);
}

export function paisaToTaka(paisa: number): number {
  return paisa / 100;
}
