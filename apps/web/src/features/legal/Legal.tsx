import { Link } from "react-router-dom";
import { ArrowLeft, FileText, ShieldCheck, Trash2 } from "lucide-react";
import { useSession } from "../../lib/session";
import { t } from "../../lib/i18n";
import { LEGAL_DOCS, LEGAL_META } from "./content";
import type { LegalDoc } from "./content";

const ICONS: Record<LegalDoc["id"], typeof FileText> = {
  privacy: ShieldCheck,
  terms: FileText,
  deletion: Trash2,
};

const URL_RE = /(https?:\/\/[^\s)]+)/g;

/**
 * Renders legal copy with any embedded URL turned into a real link. The page
 * carries the data-deletion request URL in plain text, and a raw URL both
 * overflows a phone viewport and cannot be tapped — on the one page where the
 * reader most needs to reach it.
 */
function withLinks(text: string, keyPrefix: string) {
  // Split with a capturing group puts each URL at its own index; testing the
  // prefix avoids a stateful global-regex test (lastIndex would alternate).
  return text.split(URL_RE).map((part, i) =>
    part.startsWith("http") ? (
      <a
        key={`${keyPrefix}-${i}`}
        href={part}
        target="_blank"
        rel="noreferrer noopener"
        className="break-all font-medium text-link underline decoration-link/40 hover:decoration-link"
      >
        {part}
      </a>
    ) : (
      <span key={`${keyPrefix}-${i}`}>{part}</span>
    )
  );
}

/**
 * Public legal pages (/privacy, /terms, /account-deletion). Reachable without
 * signing in — Google Play requires the privacy policy and the data-deletion
 * instructions to live at a public URL, and a user who cannot get into the app
 * must still be able to read how to delete their data.
 */
export default function Legal({ docId }: { docId: LegalDoc["id"] }) {
  const { session } = useSession();
  const lang = session?.lang ?? "bn";
  const doc = LEGAL_DOCS[docId];
  const Icon = ICONS[doc.id];

  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-6">
      <Link
        to="/"
        className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-semibold text-link hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)]"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t("backHome", lang)}
      </Link>

      <header className="mt-3 flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100"
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-stone-800">{lang === "bn" ? doc.title.bn : doc.title.en}</h1>
          <p className="mt-1 text-sm text-stone-600">{lang === "bn" ? doc.summary.bn : doc.summary.en}</p>
          <p className="mt-1 text-xs text-stone-500">
            {t("appVersionLabel", lang)} {LEGAL_META.version} ·{" "}
            {t("legalLastUpdated", lang)} {LEGAL_META.updated}
          </p>
        </div>
      </header>

      {/* Doc content itself is a bilingual content module (./content), not UI
          chrome — its {bn,en} pairs are data, so only the labels above go
          through the dictionary. */}
      <nav aria-label={t("legalNavAria", lang)} className="mt-5 flex flex-wrap gap-2">
        {(Object.keys(LEGAL_DOCS) as LegalDoc["id"][]).map((key) => {
          const d = LEGAL_DOCS[key];
          const active = key === doc.id;
          return (
            <Link
              key={key}
              to={`/${key}`}
              aria-current={active ? "page" : undefined}
              className={`inline-flex min-h-[44px] items-center rounded-full px-4 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] ${
                active
                  ? "bg-action text-white"
                  : "bg-surface-card text-stone-600 ring-1 ring-surface-border-strong hover:bg-brand-50"
              }`}
            >
              {lang === "bn" ? d.title.bn : d.title.en}
            </Link>
          );
        })}
      </nav>

      <div className="mt-5 space-y-6 rounded-xl border border-surface-border bg-surface-card p-4 shadow-sm">
        {doc.sections.map((section, i) => (
          <section key={i} className="space-y-2">
            <h2 className="text-sm font-bold text-stone-800">
              {lang === "bn" ? section.heading.bn : section.heading.en}
            </h2>
            {section.paragraphs?.map((p, j) => (
              <p key={`p${j}`} className="text-sm leading-relaxed break-words text-stone-600 [overflow-wrap:anywhere]">
                {withLinks(lang === "bn" ? p.bn : p.en, `p${i}-${j}`)}
              </p>
            ))}
            {section.bullets && (
              <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed break-words text-stone-600 [overflow-wrap:anywhere]">
                {section.bullets.map((b, j) => (
                  <li key={`b${j}`}>{withLinks(lang === "bn" ? b.bn : b.en, `b${i}-${j}`)}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </main>
  );
}
