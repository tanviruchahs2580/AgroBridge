import { motion } from "framer-motion";
import { Clock, Users } from "lucide-react";
import { formatBDT } from "../../lib/format.js";
import { serviceCategoryLabel, priceUnitLabel } from "../../lib/labels.js";
import { t } from "../../lib/i18n.js";
import type { Lang } from "../../lib/i18n.js";
import { AgriIconBox } from "../icons/AgriIcons.jsx";

interface Props {
  title: string;
  category: string;
  pricePaisa: number;
  priceUnit: string;
  description?: string;
  providers: { id: string; name: string; district?: string }[];
  lang: Lang;
  onBook: () => void;
  onDetails?: () => void;
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

export function ServiceCard({ title, category, pricePaisa, priceUnit, description, providers, lang, onBook, onDetails }: Props) {
  const hero = HERO_MAP[category] ?? HERO_MAP.TRACTOR;
  const providerCount = providers.length;
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -2 }}
      className="group flex flex-col overflow-hidden rounded-[20px] border border-[#E7E5E4] bg-white shadow-card transition-[box-shadow,border-color,transform] duration-200 hover:shadow-cardHover hover:border-[#DCFCE7] focus-within:ring-2 focus-within:ring-[#15803D] focus-within:ring-offset-2 motion-reduce:transform-none motion-reduce:transition-none"
    >
      <div className="relative h-[148px] w-full overflow-hidden rounded-t-[20px] bg-[#F8FAF7]">
        <img
          src={hero}
          alt={title}
          className="h-full w-full object-cover object-center transition duration-300 group-hover:scale-[1.03] motion-reduce:transition-none"
          loading="lazy"
          onError={(e) => ((e.target as HTMLImageElement).style.opacity = "0")}
        />
        <div className="absolute inset-0 rounded-t-[20px] bg-gradient-to-t from-black/15 via-transparent to-transparent" aria-hidden />
        <div className="absolute bottom-3 left-3 z-10 rounded-[14px] bg-white p-1 shadow-md ring-1 ring-black/5">
          <AgriIconBox category={category} size={40} />
        </div>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#15803D]">{serviceCategoryLabel(category, lang)}</p>
        <h3 className="mt-1.5 line-clamp-1 text-[16px] font-bold leading-6 text-[#1A1F1C] text-balance">{title}</h3>
        {description ? (
          <p className="mt-1.5 line-clamp-2 text-[13px] leading-5 text-[#57534E]">{description}</p>
        ) : (
          <p className="mt-1.5 text-[13px] leading-5 text-[#57534E]">{lang === "bn" ? "মাঠের কাজ দ্রুত ও নির্ভরযোগ্য" : "Fast and reliable field service"}</p>
        )}

        <div className="my-4 h-px bg-[#F5F5F4]" aria-hidden />

        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-1">
              <span className="text-[18px] font-bold tabular-nums leading-none text-[#1A1F1C]">{formatBDT(pricePaisa, lang)}</span>
              <span className="text-[12px] font-normal text-[#78716C]">{priceUnitLabel(priceUnit, lang)}</span>
            </div>
            <p className="mt-1 flex items-center gap-1 text-[12px] leading-4 text-[#78716C]">
              <Clock className="h-3 w-3" aria-hidden />
              <span>{lang === "bn" ? "২ ঘণ্টা" : "2 hrs"}</span>
              {providerCount > 0 && (
                <>
                  <span aria-hidden>•</span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="h-3 w-3" aria-hidden /> {providerCount} {lang === "bn" ? "প্রদানকারী" : "providers"}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onDetails}
            className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-[12px] border border-[#E7E5E4] bg-white px-3 py-2.5 text-[13px] font-semibold text-[#14532D] transition hover:border-[#DCFCE7] hover:bg-[#F0FDF4] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D] motion-reduce:transition-none"
          >
            {t("viewDetails", lang)}
          </button>
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={onBook}
            className="inline-flex min-h-[44px] flex-[1.2] items-center justify-center gap-1.5 rounded-[12px] bg-[#15803D] px-4 py-2.5 text-[14px] font-bold text-white shadow-button transition hover:bg-[#14532D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D] focus-visible:ring-offset-2 motion-reduce:transition-none"
          >
            {t("bookNow", lang)} <span aria-hidden>→</span>
          </motion.button>
        </div>
      </div>
    </motion.article>
  );
}

export function ServiceCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[20px] border border-[#E7E5E4] bg-white shadow-card">
      <div className="h-[148px] w-full animate-pulse bg-[#F5F5F4]" />
      <div className="p-5">
        <div className="h-3 w-24 animate-pulse rounded bg-[#F0FDF4]" />
        <div className="mt-2 h-5 w-3/4 animate-pulse rounded bg-[#F5F5F4]" />
        <div className="mt-2 h-3 w-full animate-pulse rounded bg-[#F5F5F4]" />
        <div className="my-4 h-px bg-[#F5F5F4]" />
        <div className="flex justify-between">
          <div className="h-5 w-20 animate-pulse rounded bg-[#F5F5F4]" />
          <div className="h-4 w-24 animate-pulse rounded bg-[#F5F5F4]" />
        </div>
        <div className="mt-4 flex gap-2">
          <div className="h-11 flex-1 animate-pulse rounded-[12px] bg-[#F5F5F4]" />
          <div className="h-11 flex-[1.2] animate-pulse rounded-[12px] bg-[#DCFCE7]" />
        </div>
      </div>
    </div>
  );
}
