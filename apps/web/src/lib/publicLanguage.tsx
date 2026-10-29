import { useState } from "react";
import { otherLang, t } from "./i18n";
import type { Lang } from "./i18n";
import { useSession } from "./session";

/**
 * The language of a PUBLIC screen — the one setting that has to work before any
 * session exists.
 *
 * `session.setLang` persists through the account (a PATCH), which an anonymous
 * visitor cannot do, so the choice lives in localStorage and every public surface
 * reads it from here: the auth screens, the legal documents and the not-found page.
 *
 * Having one home for it is the point. Each surface used to decide for itself, and
 * the legal documents decided `session?.lang ?? "bn"` — so a visitor who switched to
 * English on the login page, and whose choice was correctly stored, then read the
 * privacy policy in Bengali with no way to change it (found by reading the live
 * production site; a Play reviewer reading the policy is the same visitor). The
 * not-found page had the same shape.
 *
 * The stored choice wins over the account language on public screens: the visitor
 * just made it, on this screen. The authenticated app keeps using `session.lang`,
 * so a choice made here never silently flips the product's language.
 */
export const PUBLIC_LANG_KEY = "agrobridge.auth_lang";

export function usePublicLang(): [Lang, (l: Lang) => void] {
  const { session } = useSession();
  const [lang, setLang] = useState<Lang>(() => {
    try {
      const stored = localStorage.getItem(PUBLIC_LANG_KEY);
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
      localStorage.setItem(PUBLIC_LANG_KEY, l);
    } catch {
      // ignore storage errors
    }
  };
  return [lang, update];
}

/** Language pill — outlined on plain surfaces, white-glass over the auth gradient. */
export function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <button
      type="button"
      aria-label={t("langSwitchAria", lang)}
      onClick={() => onChange(otherLang(lang))}
      className="inline-flex min-h-[44px] items-center rounded-chip border border-surface-border-strong bg-surface-card px-3 text-xs font-semibold text-stone-700 shadow-sm transition-colors hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] motion-reduce:transition-none"
    >
      {t("langToggleButton", lang)}
    </button>
  );
}
