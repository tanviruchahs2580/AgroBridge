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
  { key: "authHeroValue1" as const, Icon: Bot },
  { key: "authHeroValue2" as const, Icon: Store },
  { key: "authHeroValue3" as const, Icon: Leaf },
];

/** Language pill — white glass so it reads over the field photo. */
export function AuthLangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <button
      type="button"
      aria-label={lang === "bn" ? "Switch to English" : "বাংলায় ফিরুন"}
      onClick={() => onChange(lang === "bn" ? "en" : "bn")}
      className="absolute right-4 top-4 z-20 inline-flex min-h-[36px] items-center rounded-chip border border-white/30 bg-white/15 px-3 text-xs font-bold text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:right-6 sm:top-6"
    >
      {lang === "bn" ? "EN" : "বাং"}
    </button>
  );
}

/**
 * Unified auth surface on the owner-provided golden-hour field photo: the
 * photo IS the full-page background (full-bleed on desktop and mobile, with
 * per-platform asset variants), the brand stack sits centered above a
 * translucent deep-green card. Same design on desktop and Android.
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
    <div className="agro-shell relative min-h-[100dvh] overflow-hidden">
      {/* Full-page field photo — per-platform assets, natural WebP q85 */}
      <img
        src="/brand/login-bg-desktop-full.webp"
        srcSet="/brand/login-bg-mobile-full.webp 640w, /brand/login-bg-desktop-full.webp 1600w"
        sizes="100vw"
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* Deep-green scrim: keeps photo visible on top, text AA everywhere */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#012823]/40 via-[#012823]/55 to-[#012823]/90" aria-hidden />

      <AuthLangToggle lang={lang} onChange={onToggleLang} />

      <main
        id="main"
        tabIndex={-1}
        className="relative z-10 mx-auto flex min-h-[100dvh] w-full max-w-md flex-col items-center px-4 pb-10 sm:px-6 md:max-w-xl"
        style={{ paddingTop: "max(2rem, env(safe-area-inset-top))" }}
      >
        {/* Brand stack — centered over the field, like the product reference */}
        <img
          src="/brand/logo-emblem.png"
          alt=""
          aria-hidden
          className="h-16 w-16 rounded-2xl object-cover shadow-float ring-1 ring-white/25"
        />
        <div className="mt-2.5 text-center">
          <div className="text-[22px] font-extrabold leading-none tracking-[-0.01em] text-white drop-shadow-sm">
            {t("appName", lang)}
          </div>
          <div className="mt-1.5 text-[11px] font-medium tracking-wide text-white/75">
            {t("authTagline", lang)}
          </div>
        </div>

        {/* Credential card — translucent deep green over the photo. The
            .auth-photo-scope rules (index.css) restyle the shared form
            controls for legibility on the dark glass. */}
        <section className="auth-photo-scope mt-6 w-full rounded-2xl bg-[#012823]/80 p-5 shadow-float ring-1 ring-white/15 backdrop-blur-md sm:p-6">
          <header className="mb-5">
            <h1 className="text-xl font-extrabold tracking-[-0.01em] text-white">{title}</h1>
            <p className="mt-0.5 text-[13px] text-white/70">{subtitle}</p>
          </header>
          {children}
        </section>

        {footer && <div className="auth-photo-scope mt-4 w-full text-center">{footer}</div>}

        {/* Desktop-only value line — keeps the brand promise visible on large screens */}
        <div className="mt-8 flex flex-col items-center gap-2 px-4 md:flex-row md:justify-center">
          {HERO_VALUES.map(({ key, Icon }) => (
            <span key={key} className="flex items-center gap-1.5 text-xs font-medium text-white/75">
              <Icon className="h-3.5 w-3.5 text-brand-300" aria-hidden />
              {t(key, lang)}
            </span>
          ))}
        </div>
      </main>
    </div>
  );
}
