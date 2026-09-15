import { motion } from "framer-motion";
import { Star, Users } from "lucide-react";
import { formatBDT } from "../../lib/format";
import { serviceCategoryLabel, priceUnitLabel } from "../../lib/labels";
import { t } from "../../lib/i18n";
import type { Lang } from "../../lib/i18n";
import { AgriIconBox } from "../icons/AgriIcons";

interface Props {
  title: string;
  category: string;
  pricePaisa: number;
  priceUnit: string;
  description?: string;
  providers: { id: string; name: string; district?: string; ratingCount?: number; ratingSum?: number }[];
  lang: Lang;
  onBook: () => void;
  onDetails?: () => void;
  /** Grid position — staggers the entrance choreography (transient only). */
  index?: number;
}

const HERO_MAP: Record<string, string> = {
  THRESHER: "/images/services/thresher.jpg",
  SOIL_TESTING: "/images/services/soil-test.jpg",
  POWER_TILLER: "/images/services/power-tiller.jpg",
  LAND_LEVELLER: "/images/services/land-leveller.png",
  DRONE: "/images/services/drone.jpg",
  COMBINE_HARVESTER: "/images/services/combine.jpg",
  AGRONOMIST: "/images/services/agronomist.jpg",
  TRACTOR: "/images/services/tractor.jpg",
};

// Service-specific honest fallback — distinct per category, not generic placeholder (fixes A2)
const FALLBACK_DESC: Record<string, { bn: string; en: string }> = {
  DRONE: { bn: "জমি না মাড়িয়ে দ্রুত স্প্রে — সমান কভারেজ", en: "Fast spray without trampling — even coverage" },
  TRACTOR: { bn: "ট্রাক্টর ও চালকসহ জমি প্রস্তুত — বিঘা প্রতি", en: "Tractor with operator — per bigha" },
  COMBINE_HARVESTER: { bn: "কাটা ও মাড়াই একসাথে — সময় ও শ্রম সাশ্রয়", en: "Harvest and thresh together — saves time and labour" },
  POWER_TILLER: { bn: "ছোট-মাঝারি জমিতে নিখুঁত চাষ", en: "Precise tillage for small–medium plots" },
  LAND_LEVELLER: { bn: "লেজার সমতলকরণ — সেচে পানি সাশ্রয়", en: "Laser levelling — saves irrigation water" },
  THRESHER: { bn: "পরিষ্কার দানা, কম অপচয় — মণ প্রতি", en: "Clean grain, low waste — per maund" },
  SOIL_TESTING: { bn: "ল্যাব রিপোর্ট + সার সুপারিশ — নমুনা প্রতি", en: "Lab report + fertilizer advice — per sample" },
  AGRONOMIST: { bn: "মাঠ পরিদর্শন ও ব্যবস্থাপত্র — ভিজিট প্রতি", en: "Field visit and prescription — per visit" },
};

function fallbackFor(category: string, lang: Lang): string {
  const f = FALLBACK_DESC[category];
  if (f) return lang === "bn" ? f.bn : f.en;
  return lang === "bn" ? "মাঠের সেবা — স্বচ্ছ মূল্য" : "Field service — transparent pricing";
}

export function ServiceCard({
  title,
  category,
  pricePaisa,
  priceUnit,
  description,
  providers,
  lang,
  onBook,
  onDetails,
  index = 0,
}: Props) {
  const hero = HERO_MAP[category] ?? HERO_MAP.TRACTOR;
  const providerCount = providers.length;

  // Honest aggregated rating across providers — null if no ratings yet (fixes A1)
  const totals = providers.reduce(
    (acc, p) => ({ sum: acc.sum + (p.ratingSum ?? 0), count: acc.count + (p.ratingCount ?? 0) }),
    { sum: 0, count: 0 },
  );
  const avg = totals.count > 0 ? totals.sum / totals.count : null;
  const desc = description?.trim() ? description : fallbackFor(category, lang);
  const catLabel = serviceCategoryLabel(category, lang);

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1], delay: Math.min(index, 11) * 0.05 }}
      whileHover={{ y: -2 }}
      className="group flex flex-col overflow-hidden rounded-card border border-surface-border bg-surface-card shadow-card transition-[box-shadow,border-color,transform] duration-200 hover:border-brand-200 hover:shadow-cardHover focus-within:ring-2 focus-within:ring-[var(--ring-color)] focus-within:ring-offset-2 ring-offset-[var(--color-surface-bg)] motion-reduce:transform-none motion-reduce:transition-none"
    >
      {/* Hero — fixed 16:10, consistent visual grammar (fixes A7) */}
      <div className="relative h-44 w-full overflow-hidden rounded-t-card bg-surface-subdued">
        <img
          src={hero}
          alt={`${title} — ${catLabel}`}
          className="h-full w-full object-cover object-center transition duration-300 group-hover:scale-[1.02] motion-reduce:transition-none"
          loading="lazy"
          decoding="async"
          onError={(e) => {
            (e.target as HTMLImageElement).style.opacity = "0";
          }}
        />
        {/* subtle top highlight, not heavy overlay — keeps contrast WCAG AA */}
        <div className="absolute inset-0 rounded-t-card bg-gradient-to-t from-black/10 via-transparent to-transparent" aria-hidden />
      </div>

      <div className="flex flex-1 flex-col p-5">
        {/* Category — distinct from title (fixes A3) */}
        <div className="flex items-center gap-2">
          <AgriIconBox category={category} size={32} withMotion={false} />
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-link">{catLabel}</p>
        </div>

        <h3 className="mt-1.5 line-clamp-1 text-balance text-base font-bold leading-6 text-stone-800">{title}</h3>

        {/* Service-specific description — no verbatim repetition across unrelated services (fixes A2) */}
        <p className="mt-1.5 line-clamp-2 min-h-[2.75rem] text-sm leading-5 text-stone-600">{desc}</p>

        <div className="my-4 h-px bg-surface-border" aria-hidden />

        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-bold tabular-nums leading-none text-stone-800">{formatBDT(pricePaisa, lang)}</span>
              <span className="text-xs font-normal tabular-nums text-stone-500">{priceUnitLabel(priceUnit, lang)}</span>
            </div>
            {/* Honest meta — rating from real aggregation or explicit fallback, provider count (fixes A1, A4) */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {avg !== null ? (
                <span className="inline-flex items-center gap-1 rounded-chip bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-accent ring-1 ring-inset ring-brand-100">
                  <Star className="h-3 w-3 fill-enterprise-warning text-enterprise-warning" aria-hidden />
                  {avg.toFixed(1)}
                  <span className="font-normal text-stone-600">({totals.count})</span>
                </span>
              ) : (
                <span className="inline-flex items-center rounded-chip bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-600">
                  {lang === "bn" ? "নতুন — এখনো রেটিং নেই" : "New — no ratings yet"}
                </span>
              )}
              {providerCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-chip bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-600">
                  <Users className="h-3 w-3" aria-hidden />
                  {providerCount} {lang === "bn" ? "প্রদানকারী" : providerCount === 1 ? "provider" : "providers"}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Two actions — clearly differentiated weight/purpose (fixes A6) */}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onDetails}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-button border border-surface-border-strong bg-surface-card px-3 py-2.5 text-[13px] font-semibold text-stone-800 transition hover:border-stone-300 hover:bg-stone-100 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] motion-reduce:transition-none"
          >
            {t("viewDetails", lang)}
          </button>
          <motion.button
            whileTap={{ scale: 0.985 }}
            onClick={onBook}
            className="inline-flex min-h-[44px] flex-[1.2] items-center justify-center rounded-button bg-action px-4 py-2.5 text-sm font-bold text-white shadow-button transition hover:bg-action-hover active:bg-action-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-color)] focus-visible:ring-offset-2 ring-offset-[var(--color-surface-bg)] motion-reduce:transition-none"
          >
            {t("bookNow", lang)}
          </motion.button>
        </div>
      </div>
    </motion.article>
  );
}

export function ServiceCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-card border border-surface-border bg-surface-card shadow-card" aria-hidden>
      <div className="skeleton-shimmer aspect-[16/10] w-full" />
      <div className="p-5">
        <div className="skeleton-shimmer h-3 w-24 rounded-full" />
        <div className="skeleton-shimmer mt-2 h-5 w-3/4 rounded-lg" />
        <div className="skeleton-shimmer mt-2 h-3 w-full rounded-lg" />
        <div className="my-4 h-px bg-surface-border" />
        <div className="flex justify-between">
          <div className="skeleton-shimmer h-5 w-20 rounded-lg" />
          <div className="skeleton-shimmer h-4 w-24 rounded-full" />
        </div>
        <div className="mt-4 flex gap-2">
          <div className="skeleton-shimmer h-11 flex-1 rounded-button" />
          <div className="skeleton-shimmer h-11 flex-[1.2] rounded-button" />
        </div>
      </div>
    </div>
  );
}
