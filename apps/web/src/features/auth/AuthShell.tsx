import { useState } from "react";
import type { ReactNode } from "react";
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
 * Unified auth surface: the owner-provided golden-hour field photo IS the
 * full-page background — farmer mid-left, drone top-right, the sun behind the
 * centered brand stack, form fields directly on the photo (no opaque card),
 * fading into the brand green at the bottom. Same design on desktop and
 * Android; per-platform background assets via srcSet.
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
    <div className="agro-shell relative flex min-h-[100dvh] flex-col overflow-hidden">
      {/* Full-page field photo — per-platform assets, natural WebP q85 */}
      <img
        src="/brand/login-bg-desktop-full.webp"
        srcSet="/brand/login-bg-mobile-full.webp 640w, /brand/login-bg-desktop-full.webp 1600w"
        sizes="100vw"
        alt=""
        aria-hidden
        className="absolute inset-0 h-full w-full object-cover"
      />
      {/* Scrim: clear sky up top (drone/brand readable), left mid vignette
          (farmer), strong brand-green fade at the bottom */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#012823]/25 via-[#012823]/35 to-[#012823]/95" aria-hidden />
      <div className="absolute inset-0 bg-gradient-to-r from-[#012823]/45 via-transparent to-transparent" aria-hidden />

      <AuthLangToggle lang={lang} onChange={onToggleLang} />

      <main
        id="main"
        tabIndex={-1}
        className="relative z-10 mx-auto flex w-full max-w-md flex-1 flex-col px-5 sm:px-6 md:max-w-lg"
        style={{ paddingTop: "max(2.25rem, env(safe-area-inset-top))" }}
      >
        {/* Brand stack — centered in the sky */}
        <div className="flex flex-col items-center text-center">
          <img
            src="/brand/logo-emblem.png"
            alt=""
            aria-hidden
            className="h-14 w-14 rounded-2xl object-cover shadow-float ring-1 ring-white/25"
          />
          <div className="mt-2 text-[22px] font-extrabold leading-none tracking-[-0.01em] text-white drop-shadow-sm">
            {t("appName", lang)}
          </div>
          <div className="mt-1 text-[11px] font-medium tracking-wide text-white/75">
            {t("authTagline", lang)}
          </div>
        </div>

        {/* Form — directly on the photo, controls restyled by .auth-photo-scope */}
        <section className="auth-photo-scope mt-7 w-full">
          <header className="mb-4">
            <h1 className="text-[22px] font-extrabold tracking-[-0.01em] text-white">{title}</h1>
            <p className="mt-0.5 text-[13px] text-white/75">{subtitle}</p>
          </header>
          {children}
        </section>

        {footer && <div className="auth-photo-scope mt-5 w-full text-center">{footer}</div>}
      </main>

      {/* Bottom brand band — fades the photo into AgroBridge green */}
      <footer className="relative z-10 bg-gradient-to-t from-[#012823] via-[#012823]/85 to-transparent px-4 pb-5 pt-12 text-center">
        <p className="text-[13px] font-semibold text-white">
          {lang === "bn" ? "কৃষকের জন্য তৈরি 💚 — বাংলার মাটই জানে" : "Built for farmers 💚 — rooted in Bengal's soil"}
        </p>
      </footer>
    </div>
  );
}
