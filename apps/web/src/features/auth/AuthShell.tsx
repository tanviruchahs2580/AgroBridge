import { useEffect, useState, type ReactNode } from "react";
import { Bot, Leaf, Store } from "lucide-react";
import { t } from "../../lib/i18n";
import type { Lang } from "../../lib/i18n";
import { LangToggle } from "../../lib/publicLanguage";

const HERO_VALUES = [
  { icon: Bot, key: "authHeroValue1" },
  { icon: Store, key: "authHeroValue2" },
  { icon: Leaf, key: "authHeroValue3" },
] as const;

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

/** Language pill — reads as white-glass over the gradient, outlined on plain surfaces. */


/**
 * Unified premium auth surface (v2): a branded split screen on desktop and,
 * on mobile, the golden-hour photo as a CONTINUOUS full-page background with
 * the credential panel floating over its lower field. Both auth routes render
 * inside it so Login and Register finally speak one design language.
 */
export function AuthShell({
  title,
  subtitle,
  lang,
  onToggleLang,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
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

        <div className="relative flex items-center gap-3 p-10 pb-0">
          <BrandMark />
          <div>
            <div className="text-base font-bold leading-none">{t("appName", lang)}</div>
            <div className="mt-1 text-xs font-medium tracking-wide text-white/70">{t("authTagline", lang)}</div>
          </div>
        </div>

        <div className="relative max-w-md p-10 pt-0">
          <h2 className="text-2xl font-extrabold leading-snug tracking-[-0.01em]">{t("authHeroHeadline", lang)}</h2>
          <ul className="mt-6 space-y-3.5">
            {HERO_VALUES.map(({ icon: Icon, key }) => (
              <li key={key} className="flex items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-iconBox bg-white/10 ring-1 ring-white/15">
                  <Icon className="h-[18px] w-[18px] text-brand-300" strokeWidth={2} />
                </span>
                <span className="text-sm font-medium text-white/90">{t(key, lang)}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative p-10 pt-0 text-xs font-medium text-white/60">© {new Date().getFullYear()} {t("appName", lang)}</p>
      </aside>

      {/* Form side*/}
      <main
        id="main"
        tabIndex={-1}
        className="relative flex min-h-[100dvh] flex-col px-4 pb-8 outline-none sm:px-6 md:min-h-0 md:items-center md:justify-center md:px-8"
      >
        {/* Mobile brand hero — centered over the sky, drone stays visible top-right;
 the credential card then begins around mid-screen (reference layout).*/}
        <div className="relative flex min-h-[45dvh] flex-col items-center pt-[5.5dvh] text-center text-white md:hidden">
          <img
            src="/brand/logo-emblem.webp"
            alt=""
            aria-hidden
            className="h-16 w-16 rounded-2xl object-cover shadow-float ring-1 ring-white/25"
          />
          <div className="mt-2.5 text-xl font-extrabold leading-none tracking-[-0.01em] drop-shadow-sm">
            {t("appName", lang)}
          </div>
          <div className="mt-1.5 text-xs font-medium tracking-wide text-white/75">
            {t("authTagline", lang)}
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
              <div className="min-w-0">
                <h1 className="text-xl font-extrabold tracking-[-0.01em] text-white md:text-stone-800">{title}</h1>
                <p className="mt-0.5 text-sm text-white/75 md:text-stone-500">{subtitle}</p>
              </div>
            </header>
            {children}
          </section>

          {footer && <div className="mt-4">{footer}</div>}

          {/* Mobile: login-page value copy (was the demo-account section)*/}
          <div className="mt-6 space-y-3.5 pb-4 md:hidden">
            <h2 className="text-lg font-extrabold leading-snug tracking-[-0.01em] text-white drop-shadow-sm">
              {t("authHeroHeadline", lang)}
            </h2>
            <ul className="space-y-2.5">
              {HERO_VALUES.map(({ icon: Icon, key }) => (
                <li key={key} className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                    <Icon className="h-3.5 w-3.5 text-brand-300" strokeWidth={2} />
                  </span>
                  <span className="text-sm font-medium leading-snug text-white/90">{t(key, lang)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
