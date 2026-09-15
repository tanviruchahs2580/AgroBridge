import { useState } from "react";
import type { ReactNode } from "react";
import { Bot, Leaf, Sprout, Store } from "lucide-react";
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
  const icon = size === "lg" ? "h-7 w-7" : "h-5 w-5";
  return (
    <span
      aria-hidden
      className={`flex ${box} items-center justify-center bg-cta shadow-button ring-1 ring-white/20`}
    >
      <Sprout className={`${icon} text-white`} strokeWidth={2.2} />
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
      className="inline-flex min-h-[36px] items-center rounded-chip border border-surface-border-strong bg-surface-card px-3 text-xs font-semibold text-stone-700 shadow-sm transition-colors hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] motion-reduce:transition-none"
    >
      {lang === "bn" ? "EN" : "বাং"}
    </button>
  );
}

/**
 * Unified premium auth surface (v2): a branded split screen on desktop and a
 * gradient band + card on mobile. Both auth routes render inside it so Login
 * and Register finally speak one design language.
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
    <div className="agro-shell min-h-[100dvh] md:grid md:grid-cols-[1.05fr_1fr]">
      {/* Brand panel — desktop only */}
      <aside className="relative hidden overflow-hidden bg-hero p-10 text-white md:flex md:flex-col md:justify-between" aria-hidden>
        {/* Field texture */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(ellipse at 30% 20%, white 1px, transparent 1.5px), radial-gradient(ellipse at 70% 80%, white 1px, transparent 1.5px)",
            backgroundSize: "180px 180px, 220px 220px",
          }}
        />
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full blur-3xl" style={{ backgroundColor: "var(--color-brand-400)", opacity: 0.2 }} />
        <div className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full blur-3xl" style={{ backgroundColor: "var(--color-brand-500)", opacity: 0.15 }} />

        <div className="relative flex items-center gap-3">
          <BrandMark />
          <div>
            <div className="text-base font-bold leading-none">{t("appName", lang)}</div>
            <div className="mt-1 text-[11px] font-medium tracking-wide text-white/70">{t("authTagline", lang)}</div>
          </div>
        </div>

        <div className="relative max-w-md">
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

        <p className="relative text-xs font-medium text-white/60">© {new Date().getFullYear()} {t("appName", lang)}</p>
      </aside>

      {/* Form panel */}
      <main
        id="main"
        tabIndex={-1}
        className="relative flex min-h-[100dvh] flex-col px-4 pb-8 outline-none sm:px-6 md:min-h-0 md:items-center md:justify-center md:px-8"
      >
        {/* Mobile brand band */}
        <div className="relative -mx-4 overflow-hidden bg-hero px-4 pb-14 pt-6 text-white sm:-mx-6 md:hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage: "radial-gradient(ellipse at 30% 20%, white 1px, transparent 1.5px)",
              backgroundSize: "160px 160px",
            }}
          />
          <div className="relative flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <BrandMark />
              <div>
                <div className="text-[15px] font-bold leading-none">{t("appName", lang)}</div>
                <div className="mt-1 text-[10px] font-medium tracking-wide text-white/70">{t("authTagline", lang)}</div>
              </div>
            </div>
            <AuthLangToggle lang={lang} onChange={onToggleLang} />
          </div>
        </div>

        <div className="relative -mt-8 w-full max-w-md md:mt-0">
          {/* Desktop: toggle lives above the card, right-aligned */}
          <div className="mb-3 hidden justify-end md:flex">
            <AuthLangToggle lang={lang} onChange={onToggleLang} />
          </div>

          <section className="rounded-t-card border border-surface-border bg-surface-card p-5 shadow-card sm:p-6 md:rounded-card">
            <header className="mb-5 flex items-center gap-3">
              <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-iconBox bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100 md:hidden">
                <Sprout className="h-6 w-6" strokeWidth={2.2} />
              </span>
              <div className="min-w-0">
                <h1 className="text-xl font-extrabold tracking-[-0.01em] text-stone-800">{title}</h1>
                <p className="mt-0.5 text-[13px] text-stone-500">{subtitle}</p>
              </div>
            </header>
            {children}
          </section>

          {footer && <div className="mt-4">{footer}</div>}
        </div>
      </main>
    </div>
  );
}
