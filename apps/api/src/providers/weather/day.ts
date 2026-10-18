/**
 * Calendar-date helper for weather grouping.
 *
 * A farming day follows the local calendar, and this product is Bangladesh-first:
 * Asia/Dhaka (UTC+6, no DST since 2009). Grouping forecasts by the UTC date put
 * every slot from 18:00Z onward into the wrong day (18:00Z is already 00:00 the
 * next Dhaka day), which shifted rain/temperature summaries by one day for the
 * evening slots. The format is the DB/UI convention YYYY-MM-DD.
 */
export function dhakaDate(instant: Date | string): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
