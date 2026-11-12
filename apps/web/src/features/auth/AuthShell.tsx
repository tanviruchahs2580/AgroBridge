// `useEffect`/`useState` are `useIsDesktop`'s — it picks the one hero crop the
// viewport actually needs. The lucide imports are the features strip's icons,
// back with the owner's approved mock (2026-11-12) after the earlier pass that
// removed the value bullets took them out with it.
import { useEffect, useState, type ReactNode } from "react";
import { Leaf, Store, Tractor } from "lucide-react";
import { t } from "../../lib/i18n";
import type { Lang } from "../../lib/i18n";
import { LangToggle } from "../../lib/publicLanguage";

/**
 * Which hero crop this viewport needs. A `display:none` image is still
 * FETCHED by browsers, so rendering both crops and hiding one with `md:hidden`
 * shipped 171 KB of desktop photo to every mobile login — measured as the
 * single biggest transfer on the Slow-4G profile, past the LCP budget.
 * Rendering only the needed crop (with a live listener so resizing still
 * swaps it) fetches exactly one file per viewport.
 */
function useIsDesktop(): boolean {
  // jsdom (component tests) has `window` but no matchMedia — fall back to the
  // desktop crop there rather than throwing inside the auth forms.
  const supported = typeof window !== "undefined" && typeof window.matchMedia === "function";
  const [desktop, setDesktop] = useState(() =>
    supported ? window.matchMedia("(min-width: 768px)").matches : true
  );
  useEffect(() => {
    if (!supported) return;
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = () => setDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [supported]);
  return desktop;
}

function BrandMark({ size = "md" }: { size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-14 w-14 rounded-2xl" : "h-10 w-10 rounded-xl";
  return (
    <span
      aria-hidden
      className={`flex ${box} items-center justify-center overflow-hidden shadow-button ring-1 ring-white/20`}
    >
      <img src="/brand/logo-mark.webp" alt="" className="h-full w-full object-cover" loading="eager" />
    </span>
  );
}

/**
 * The three value bullets the owner's login mock restored (2026-11-12). Two
 * deliberate constraints: each row is one compact line (a 32px icon tile and a
 * 13px label) so the strip cannot push the form below the fold on a 360px
 * phone, and the tiles are decorative only — the label carries the meaning.
 */
function AuthFeatures({ lang }: { lang: Lang }) {
  // The label doubles as the list key: it is unique by construction here, and
  // calling t() with a literal key is what keeps the i18n scan able to see all
  // three (a `t(key, lang)` over a key table would hide them from it).
  const bullets = [
    { icon: Leaf, label: t("authFeatureDiseasePhoto", lang) },
    { icon: Store, label: t("authFeatureDirectMarket", lang) },
    { icon: Tractor, label: t("authFeatureServices", lang) },
  ];
  return (
    <section className="mt-7 md:hidden" aria-labelledby="auth-features-heading">
      <h2 id="auth-features-heading" className="text-md font-extrabold leading-snug text-white">
        {t("authFeaturesHeading", lang)}
      </h2>
      <ul className="mt-3 space-y-2.5">
        {bullets.map(({ icon: Icon, label }) => (
          <li key={label} className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/10 text-brand-300"
            >
              <Icon className="h-4 w-4" strokeWidth={2} />
            </span>
            <span className="min-w-0 text-sm font-medium leading-snug text-white/90">{label}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Unified auth surface: a branded split screen on desktop and, on mobile, the
 * owner-approved composition of 2026-11-12 — a golden-hour photo hero across
 * the top whose lower edge dissolves into the page's deep-green surface, the
 * credential panel (all four corners rounded) overlapping the hero's foot, and
 * the way to the other task below it. All three auth routes render inside it so
 * they speak one design language; a route brings its own title (and, where the
 * route has one, its own sub-line).
 *
 * REVERSAL, 2026-11-12 — the owner's approved login mock supersedes two calls
 * this file used to record:
 *   - "the first screen a user sees is not the place to sell" had removed the
 *     headline + three value bullets, and a second copy of them below the card.
 *     The mock brings them back as one compact strip below the way to the other
 *     task, so Login opts in with `features` (Register and Reset show none).
 *   - the brand now carries its tagline ("AI কৃষকের হাতে") under the name in the
 *     hero — the mock's one placement for it.
 * Unchanged: the panel is the form's home; it carries no argument beyond the
 * heading and sub-line its route passes in.
 */
export function AuthShell({
  title,
  subline,
  features = false,
  lang,
  onToggleLang,
  children,
  footer,
}: {
  title: string;
  /**
   * Optional second line under the title. Only Login passes one (the mock's
   * "আপনার অ্যাকাউন্টে লগইন করুন"); Register and Reset name their task in the
   * title alone.
   */
  subline?: string;
  /** Show the mobile features strip (the owner's login mock). Login only. */
  features?: boolean;
  lang: Lang;
  onToggleLang: (l: Lang) => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const isDesktop = useIsDesktop();
  return (
    <div className="agro-shell auth-page-mobile relative min-h-[100dvh] md:grid md:grid-cols-[1.05fr_1fr]">
      {/* Mobile hero (mock, 2026-11-12): the photo fills the top band and its
          bottom edge fades into the page surface, so the panel below reads as
          one piece with the page. Only the crop this viewport needs is rendered
          — see useIsDesktop.

          It is a full-width child of the PAGE, not of <main>: as a flex item of
          the padded main, `-mx-4` resolved to a 422px box starting 16px left of
          the viewport (Chrome sized the stretch against main's padding box), so
          the page overflowed by 16px and mobile Chrome zoomed the layout out to
          fit. A block at the root has no such question — it is exactly as wide
          as the page. */}
      {!isDesktop && (
        <div className="relative flex h-[52dvh] flex-col items-center overflow-hidden pt-[5dvh] text-center text-white md:hidden">
          <img
            src="/brand/login-bg-mobile-full.webp"
            alt=""
            aria-hidden
            // The page's LCP element: give it the first slot in the queue and let
            // decode happen off the main thread (4x CPU slowdown is the target).
            {...{ fetchpriority: "high", decoding: "async" }}
            className="absolute inset-0 h-full w-full object-cover object-top"
          />
          <div className="absolute inset-0 bg-[image:var(--gradient-auth-scrim-mobile)]" aria-hidden />
          {/* The hero's foot dissolves into the surface the panel sits on. */}
          <div className="absolute inset-x-0 bottom-0 h-[45%] bg-[image:var(--gradient-auth-hero-fade)]" aria-hidden />

          <img
            src="/brand/logo-emblem.webp"
            alt=""
            aria-hidden
            className="relative h-16 w-16 rounded-2xl object-cover shadow-float ring-1 ring-white/25"
          />
          {/* `leading-none` on 18px Bengali clipped the matras; `leading-tight`
              gives the line box room without shifting the stack. */}
          <div className="relative mt-2.5 text-xl font-extrabold leading-tight tracking-[-0.01em] drop-shadow-sm">
            {t("appName", lang)}
          </div>
          <div className="relative mt-1.5 text-xs font-medium text-white/85 drop-shadow-sm">
            {t("authBrandLine", lang)}
          </div>
        </div>
      )}

      {/* Language pill — top-right corner over the photo. Positioned against the
          PAGE, not <main>: main now begins below the mobile hero, so anchoring
          it there would drop the control into the credential panel (found in
          the 2026-11-12 browser check). z-10 keeps it above the hero photo and
          above main's stacking level. */}
      <div className="absolute right-4 top-4 z-10 md:hidden">
        <LangToggle lang={lang} onChange={onToggleLang} />
      </div>

      {/* Brand panel — desktop only. The owner-provided golden-hour field photo
 carries the panel; a deep-green scrim keeps every text token AA.*/}
      <aside className="relative hidden overflow-hidden bg-hero text-white md:flex md:flex-col md:justify-between" aria-hidden>
        {isDesktop && (
          <img
            src="/brand/login-bg-desktop.webp"
            srcSet="/brand/login-bg-mobile.webp 640w, /brand/login-bg-desktop.webp 1600w"
            sizes="(min-width: 768px) 50vw, 100vw"
            alt=""
            aria-hidden
            {...{ fetchpriority: "high", decoding: "async" }}
            className="absolute inset-0 h-full w-full object-cover object-[center_64%]"
          />
        )}
        <div className="absolute inset-0 bg-[image:var(--gradient-auth-scrim-panel)]" />

        <div className="relative flex items-center gap-3 p-10">
          <BrandMark />
          <div className="text-base font-bold leading-tight">{t("appName", lang)}</div>
        </div>

        <p className="relative p-10 text-xs font-medium text-white/60">© {new Date().getFullYear()} {t("appName", lang)}</p>
      </aside>

      {/* Form side. No mobile min-height: the shell root already covers the
          viewport (min-h-[100dvh] + .agro-shell's surface), and the hero above
          main has already spent 52dvh of it — a second 100dvh here scrolled the
          page half a screen past its own content. */}
      <main
        id="main"
        tabIndex={-1}
        className="relative flex flex-col px-4 pb-8 outline-none sm:px-6 md:items-center md:justify-center md:px-8"
      >
        <div className="auth-photo-mobile relative -mt-[14dvh] w-full max-w-md mx-auto md:mt-0">
          {/* Desktop: toggle lives above the card, right-aligned*/}
          <div className="mb-3 hidden justify-end md:flex">
            <LangToggle lang={lang} onChange={onToggleLang} />
          </div>

          <section className="rounded-card border border-white/15 bg-[var(--color-auth-card)] p-5 shadow-card backdrop-blur-md sm:p-6 md:border-surface-border md:bg-surface-card md:backdrop-blur-none">
            <header className="mb-5">
              <div className="flex items-center gap-3">
                <span aria-hidden className="hidden h-11 w-11 shrink-0 overflow-hidden rounded-iconBox ring-1 ring-brand-100 md:block">
                  <img src="/brand/logo-mark.webp" alt="" className="h-full w-full object-cover" />
                </span>
                <h1 className="text-xl font-extrabold tracking-[-0.01em] text-white md:text-stone-800">{title}</h1>
              </div>
              {subline && <p className="mt-1.5 text-sm text-white/80 md:text-stone-600">{subline}</p>}
            </header>
            {children}
          </section>

          {footer && <div className="mt-4">{footer}</div>}

          {features && <AuthFeatures lang={lang} />}
        </div>
      </main>
    </div>
  );
}
