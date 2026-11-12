import { Link } from "react-router-dom";
import { Bell, Bot, ChevronRight, Tractor, Wheat } from "lucide-react";
import { t, type DictKey, type Lang } from "../../lib/i18n";

/**
 * দ্রুত সেবা (Quick Services) — owner-approved design, 2026-11-12.
 *
 * Presentational only, per the handoff's component contract: it receives the
 * screen's already-fetched unread state as props and owns no state, no request
 * and no business logic. Every destination below is the SAME one the section
 * used before this redesign — the four tiles that lived inline in Home.tsx
 * pointed at /advisor, /services, /sell and /notifications, and the header
 * action reuses the existing services listing (the repository has no separate
 * "all services" route, and the handoff forbids inventing one).
 *
 * Surface rules: the panel is theme-invariant dark forest green (its own
 * section-scoped --qs-* tokens, no global theme change), the cards are plain
 * alpha over that gradient with NO backdrop-filter — cheap on low-end devices
 * and readable whether or not a compositor honours transparency — and the
 * atmosphere is two static radial gradients with no animation, so nothing here
 * loops, glows or blurs.
 */

type Card = {
  /** Destination reused from the pre-redesign section — never a new route. */
  to: string;
  labelKey: DictKey;
  icon: typeof Bot;
  /** Icon circle: token names, so the component carries no colour literal. */
  circleStyle: React.CSSProperties;
  iconStyle: React.CSSProperties;
};

const CARDS: Card[] = [
  {
    to: "/advisor",
    labelKey: "aiAgent",
    icon: Bot,
    circleStyle: { backgroundColor: "var(--qs-accent-ai)" },
    iconStyle: { color: "var(--qs-accent-ai-ink)" },
  },
  {
    to: "/services",
    labelKey: "services",
    icon: Tractor,
    circleStyle: { backgroundColor: "var(--qs-accent-services)" },
    iconStyle: { color: "var(--qs-accent-services-ink)" },
  },
  {
    to: "/sell",
    labelKey: "sellCrop",
    icon: Wheat,
    circleStyle: { backgroundColor: "var(--qs-accent-crop)" },
    iconStyle: { color: "var(--qs-accent-crop-ink)" },
  },
  {
    to: "/notifications",
    labelKey: "notifications",
    icon: Bell,
    circleStyle: { backgroundColor: "var(--qs-accent-notifications)" },
    iconStyle: { color: "var(--qs-accent-notifications-ink)" },
  },
];

export function QuickServices({
  lang,
  unread,
  unreadKnown,
}: {
  lang: Lang;
  /** Canonical unread count from the screen's notifications resource. */
  unread: number;
  /** False while that read has failed — the count is then unknown, not zero. */
  unreadKnown: boolean;
}) {
  return (
    <section
      className="qs-section animate-enterprise relative overflow-hidden rounded-card shadow-float"
      style={{ animationDelay: "220ms" } as React.CSSProperties}
      aria-labelledby="quick-services-heading"
    >
      <div aria-hidden className="qs-atmosphere pointer-events-none absolute inset-0" />
      <div className="relative p-3.5 sm:p-4">
        <div className="flex items-center justify-between gap-3 px-0.5">
          <h2 id="quick-services-heading" className="text-base font-extrabold leading-tight text-[color:var(--qs-text-primary)] sm:text-lg">
            {t("quickActions", lang)}
          </h2>
          {/* The repository has no all-services route; /services is the only
              existing services listing, so the header action reuses it rather
              than inventing a screen (handoff §5). Flagged in the report. */}
          <Link
            to="/services"
            className="inline-flex min-h-[44px] shrink-0 items-center gap-1 rounded-chip border border-[color:var(--qs-card-border)] bg-white/5 px-3 text-sm font-semibold text-[color:var(--qs-text-secondary)] transition duration-150 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none"
          >
            {t("viewAll", lang)}
            <ChevronRight className="h-4 w-4" aria-hidden strokeWidth={2.5} />
          </Link>
        </div>

        {/* 2×2, the approved composition. Below 360px the app's own pattern for
            exceptionally narrow widths applies (single column) rather than
            clipping a Bengali label or shrinking the touch target. */}
        <div className="mt-3 grid grid-cols-2 gap-2.5 max-[359px]:grid-cols-1 sm:gap-3">
          {CARDS.map(({ to, labelKey, icon: Icon, circleStyle, iconStyle }) => (
            <Link
              key={to}
              to={to}
              className="qs-card flex min-h-[64px] items-center gap-2.5 rounded-card p-2.5 transition duration-150 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none motion-reduce:active:scale-100 sm:gap-3 sm:p-3"
            >
              {/* Positioning wrapper is NOT aria-hidden: the badges below are
                  siblings of the decorative icon (not children of it), so the
                  unread state reaches assistive tech. The first cut nested them
                  inside the aria-hidden circle and the count was announced
                  nowhere — caught by the end-user browser check. */}
              <span className="relative flex h-12 w-12 shrink-0 items-center justify-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full" style={circleStyle} aria-hidden>
                  <Icon className="h-6 w-6" style={iconStyle} strokeWidth={2} />
                </span>
                {/* Unread indicator lives on the notification icon, as in the
                    reference. Count convention preserved from the previous
                    tile (9+ cap) — the app already had a count, so a bare dot
                    would be a downgrade; the sr-only text is what carries the
                    state to assistive tech, colour alone never does. */}
                {to === "/notifications" && unreadKnown && unread > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-enterprise-critical-strong px-1 text-xs font-bold text-white ring-2 ring-[color:var(--qs-section-end)]">
                    <span aria-hidden>{unread > 9 ? "9+" : unread}</span>
                    <span className="sr-only">
                      {t("notifUnread", lang)} {unread}
                    </span>
                  </span>
                )}
                {/* A failed notifications read keeps the previous screen's
                    honest "unknown" marker — never a silent clean inbox. */}
                {to === "/notifications" && !unreadKnown && (
                  <span className="absolute -right-1 -top-1 flex h-5 items-center justify-center rounded-full bg-warning-bg px-1.5 text-xs font-bold text-warning-text ring-2 ring-[color:var(--qs-section-end)]">
                    <span aria-hidden>!</span>
                    <span className="sr-only">{t("unreadCountUnavailable", lang)}</span>
                  </span>
                )}
              </span>
              {/* `text-start` + normal wrapping: the Bengali label may take two
                  lines (the first one does) and must never be clipped or
                  shrunk to fit. */}
              <span className="min-w-0 flex-1 text-start text-sm font-bold leading-snug text-[color:var(--qs-text-primary)]">
                {t(labelKey, lang)}
              </span>
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/5 text-[color:var(--qs-text-muted)]"
                aria-hidden
              >
                <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export default QuickServices;
