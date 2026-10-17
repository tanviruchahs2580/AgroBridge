import { useState } from "react";
import type { ReactNode } from "react";
import { Bot, Leaf, Store } from "lucide-react";
import { t } from "../../lib/i18n";
import type { Lang } from "../../lib/i18n";
import { useSession } from "../../lib/session";

/** Pre-login language preference — localStorage-backed so the toggle works
 *  before any session exists (session.setLang would fire a doomed PATCH). */
const AUTH_LANG_KEY = "agrobridge.auth_lang";

export function useAuthLang(): [Lang, (l: Lang) => void] {
  const { session } = useSession();
  const [lang, setLang] = useState<Lang>(() => {
    try {
      const stored = localStorage.getItem(AUTH_LANG_KEY);
      if (stored === "bn" || stored === "en") return stored;
    } catch {
      // ignore storage errors (private mode)
    }
    return session?.lang ?? "bn";
  });
  const update = (l: Lang) => {
    setLang(l);
    document.documentElement.lang = l;
    try {
      localStorage.setItem(AUTH_LANG_KEY, l);
    } catch {
      // ignore storage errors
    }
  };
  return [lang, update];
}

const HERO_VALUES = [
  { icon: Bot, key: "authHeroValue1" },
  { icon: Store, key: "authHeroValue2" },
  { icon: Leaf, key: "authHeroValue3" },
] as const;

function BrandMark({ size = "md" }: { size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-14 w-14 rounded-2xl" : "h-10 w-10 rounded-xl";
  return (
    <span
      aria-hidden
      className={`flex ${box} items-center justify-center overflow-hidden shadow-button ring-1 ring-white/20`}
    >
      <img src="/brand/logo-mark.png" alt="" className="h-full w-full object-cover" loading="eager" />
    </span>
  );
}

/** Language pill — reads as white-glass over the gradient, outlined on plain surfaces. */
export function AuthLangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <button
      type="button"
      aria-label={lang === "bn" ? "Switch to English" : "বাংলায় ফিরুন"}
      onClick={() => onChange(lang === "bn" ? "en" : "bn")}
      className="inline-flex min-h-[44px] items-center rounded-chip border border-surface-border-strong bg-surface-card px-3 text-xs font-semibold text-stone-700 shadow-sm transition-colors hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] motion-reduce:transition-none"
    >
      {lang === "bn" ? "EN" : "বাং"}
    </button>
  );
}

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
  return (
    <div className="agro-shell relative min-h-[100dvh] md:grid md:grid-cols-[1.05fr_1fr]">
      {/* Mobile: the photo is the whole page — nothing cuts off behind the form */}
      <img
        src="/brand/login-bg-mobile-full.webp"
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover md:hidden"
      />
      <div
        className="absolute inset-0 bg-gradient-to-b from-[#012823]/25 via-[#012823]/30 to-[#012823]/90 md:hidden"
        aria-hidden
      />

      {/* Brand panel — desktop only. The owner-provided golden-hour field photo
          carries the panel; a deep-green scrim keeps every text token AA. */}
      <aside className="relative hidden overflow-hidden bg-hero text-white md:flex md:flex-col md:justify-between" aria-hidden>
        <img
          src="/brand/login-bg-desktop.webp"
          srcSet="/brand/login-bg-mobile.webp 640w, /brand/login-bg-desktop.webp 1600w"
          sizes="(min-width: 768px) 50vw, 100vw"
          alt=""
          aria-hidden
          className="absolute inset-0 h-full w-full object-cover object-[center_64%]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#012823]/95 via-[#012823]/70 to-[#012823]/35" />

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

      {/* Form side */}
      <main
        id="main"
        tabIndex={-1}
        className="relative flex min-h-[100dvh] flex-col px-4 pb-8 outline-none sm:px-6 md:min-h-0 md:items-center md:justify-center md:px-8"
      >
        {/* Mobile brand hero — centered over the sky, drone stays visible top-right;
            the credential card then begins around mid-screen (reference layout). */}
        <div className="relative flex min-h-[45dvh] flex-col items-center pt-[5.5dvh] text-center text-white md:hidden">
          <img
            src="/brand/logo-emblem.png"
            alt=""
            aria-hidden
            className="h-16 w-16 rounded-2xl object-cover shadow-float ring-1 ring-white/25"
          />
          <div className="mt-2.5 text-[22px] font-extrabold leading-none tracking-[-0.01em] drop-shadow-sm">
            {"AgroBridge"}
          </div>
          <div className="mt-1.5 text-xs font-medium tracking-wide text-white/75">
            {t("authTagline", lang)}
          </div>
        </div>

        {/* Language pill — top-right corner over the photo (mobile) */}
        <div className="absolute right-4 top-4 z-10 md:hidden">
          <AuthLangToggle lang={lang} onChange={onToggleLang} />
        </div>

        <div className="auth-photo-mobile relative w-full max-w-md md:mt-0">
          {/* Desktop: toggle lives above the card, right-aligned */}
          <div className="mb-3 hidden justify-end md:flex">
            <AuthLangToggle lang={lang} onChange={onToggleLang} />
          </div>

          <section className="rounded-t-card border border-white/15 bg-[#012823]/85 p-5 shadow-card backdrop-blur-md sm:p-6 md:rounded-card md:border-surface-border md:bg-surface-card md:backdrop-blur-none">
            <header className="mb-5 flex items-center gap-3">
              <span aria-hidden className="hidden h-11 w-11 shrink-0 overflow-hidden rounded-iconBox ring-1 ring-brand-100 md:block">
                <img src="/brand/logo-mark.png" alt="" className="h-full w-full object-cover" />
              </span>
              <div className="min-w-0">
                <h1 className="text-xl font-extrabold tracking-[-0.01em] text-white md:text-stone-800">{title}</h1>
                <p className="mt-0.5 text-sm text-white/75 md:text-stone-500">{subtitle}</p>
              </div>
            </header>
            {children}
          </section>

          {footer && <div className="mt-4">{footer}</div>}

          {/* Mobile: login-page value copy (was the demo-account section) */}
          <div className="mt-6 space-y-3.5 pb-4 md:hidden">
            <h2 className="text-[18px] font-extrabold leading-snug tracking-[-0.01em] text-white drop-shadow-sm">
              {t("authHeroHeadline", lang)}
            </h2>
            <ul className="space-y-2.5">
              {HERO_VALUES.map(({ icon: Icon, key }) => (
                <li key={key} className="flex items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                    <Icon className="h-3.5 w-3.5 text-brand-300" strokeWidth={2} />
                  </span>
                  <span className="text-[12.5px] font-medium leading-snug text-white/90">{t(key, lang)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
