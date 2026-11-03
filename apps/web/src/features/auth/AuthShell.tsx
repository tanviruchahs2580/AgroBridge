// `useEffect`/`useState` are `useIsDesktop`'s, which main added to pick the one
// hero crop the viewport actually needs; the lucide imports that used to be here
// carried the value-bullet icons this pass removed.
import { useEffect, useState, type ReactNode } from "react";
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
 * Unified auth surface: a branded split screen on desktop and, on mobile, the
 * golden-hour photo as a CONTINUOUS full-page background with the credential
 * panel floating over its lower field. Both auth routes render inside it so
 * Login and Register speak one design language.
 *
 * It carries the brand and the form, and nothing that argues for the product.
 * The headline + three value bullets that used to fill this panel (and a second
 * copy of them below the card on mobile) restated what the person already
 * decided when they opened the app or tapped "Register" — the first screen a
 * user sees is not the place to sell, and on a 360px phone they pushed the
 * actual form below the fold. What remains: the mark, the title of the task,
 * the fields, and the way to the other task.
 */
export function AuthShell({
  title,
  lang,
  onToggleLang,
  children,
  footer,
}: {
  title: string;
  lang: Lang;
  onToggleLang: (l: Lang) => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const isDesktop = useIsDesktop();
  return (
    <div className="agro-shell relative min-h-[100dvh] md:grid md:grid-cols-[1.05fr_1fr]">
      {/* Mobile: the photo is the whole page — nothing cuts off behind the form*/}
      {!isDesktop && (
        <img
          src="/brand/login-bg-mobile-full.webp"
          alt=""
          aria-hidden
          // The page's LCP element: give it the first slot in the queue and let
          // decode happen off the main thread (4x CPU slowdown is the target).
          {...{ fetchpriority: "high", decoding: "async" }}
          className="absolute inset-0 h-full w-full object-cover md:hidden"
        />
      )}
      <div
        className="absolute inset-0 bg-[image:var(--gradient-auth-scrim-mobile)] md:hidden"
        aria-hidden
      />

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
          <div className="text-base font-bold leading-none">{t("appName", lang)}</div>
        </div>

        <p className="relative p-10 text-xs font-medium text-white/60">© {new Date().getFullYear()} {t("appName", lang)}</p>
      </aside>

      {/* Form side*/}
      <main
        id="main"
        tabIndex={-1}
        className="relative flex min-h-[100dvh] flex-col px-4 pb-8 outline-none sm:px-6 md:min-h-0 md:items-center md:justify-center md:px-8"
      >
        {/* Mobile brand hero — the mark over the sky, the card beginning around
 mid-screen (reference layout). It is a letterhead, not a landing page.*/}
        <div className="relative flex min-h-[38dvh] flex-col items-center pt-[7dvh] text-center text-white md:hidden">
          <img
            src="/brand/logo-emblem.webp"
            alt=""
            aria-hidden
            className="h-16 w-16 rounded-2xl object-cover shadow-float ring-1 ring-white/25"
          />
          <div className="mt-2.5 text-xl font-extrabold leading-none tracking-[-0.01em] drop-shadow-sm">
            {t("appName", lang)}
          </div>
        </div>

        {/* Language pill — top-right corner over the photo (mobile)*/}
        <div className="absolute right-4 top-4 z-10 md:hidden">
          <LangToggle lang={lang} onChange={onToggleLang} />
        </div>

        <div className="auth-photo-mobile relative w-full max-w-md md:mt-0">
          {/* Desktop: toggle lives above the card, right-aligned*/}
          <div className="mb-3 hidden justify-end md:flex">
            <LangToggle lang={lang} onChange={onToggleLang} />
          </div>

          <section className="rounded-t-card border border-white/15 bg-[var(--color-auth-card)] p-5 shadow-card backdrop-blur-md sm:p-6 md:rounded-card md:border-surface-border md:bg-surface-card md:backdrop-blur-none">
            <header className="mb-5 flex items-center gap-3">
              <span aria-hidden className="hidden h-11 w-11 shrink-0 overflow-hidden rounded-iconBox ring-1 ring-brand-100 md:block">
                <img src="/brand/logo-mark.webp" alt="" className="h-full w-full object-cover" />
              </span>
              <h1 className="text-xl font-extrabold tracking-[-0.01em] text-white md:text-stone-800">{title}</h1>
            </header>
            {children}
          </section>

          {footer && <div className="mt-4">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
