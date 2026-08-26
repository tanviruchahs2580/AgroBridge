// Bilingual formatting + money conversion helpers.
import type { Lang } from "./i18n.js";

const CURRENCY_LOCALE: Record<Lang, string> = { bn: "bn-BD", en: "en-IN" };
const DATE_LOCALE: Record<Lang, string> = { bn: "bn-BD", en: "en-GB" };

type DateInput = Date | string | number;

function toDate(d: DateInput): Date {
  return d instanceof Date ? d : new Date(d);
}

/** Format paisa as BDT currency with zero decimals, consistent digits per language (Bengali vs Latin numerals). */
export function formatBDT(paisa: number, lang: Lang): string {
  return new Intl.NumberFormat(CURRENCY_LOCALE[lang], {
    style: "currency",
    currency: "BDT",
    maximumFractionDigits: 0,
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
