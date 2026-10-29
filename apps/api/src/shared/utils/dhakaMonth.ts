/**
 * Start of the current calendar month in Asia/Dhaka, as a UTC instant.
 *
 * The "this month" boundary for money-adjacent windows is a business-calendar
 * boundary: farmers and ops read these figures in Dhaka time. Computing it
 * from the server's local clock moved records made between 00:00 and 06:00
 * Dhaka into the wrong month on a UTC host. The year/month are read with Intl
 * (never local-time getters) and the instant is built arithmetically: Dhaka is
 * UTC+6 with no DST (Bangladesh dropped DST in 2009), so 00:00 on the 1st is
 * exactly 18:00Z on the last day of the previous UTC month.
 *
 * Shared by the wallet summary (modules/payments) and the AI monthly budget
 * window (providers/ai/gateway) so both calendars agree (AUD-V3: they used
 * to differ — server-local month vs Dhaka business month).
 */
export function dhakaMonthStart(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return new Date(Date.UTC(year, month - 1, 1) - 6 * 60 * 60 * 1000);
}

/**
 * A calendar date as an Asia/Dhaka reader would say it.
 *
 * User-visible dates must not be formatted in the host's zone: the API runs on
 * UTC, so `toDateString()` on a visit scheduled for 06:00 Dhaka announced the
 * previous day in a booking confirmation (AUD-119). Same reasoning as
 * `dhakaMonthStart` — read the calendar with Intl, never with local getters.
 */
export function dhakaDateLabel(when: Date, locale: "bn-BD" | "en-GB" = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, { timeZone: "Asia/Dhaka", dateStyle: "medium" }).format(when);
}
