import { motion } from "framer-motion";
import { Clock, ShieldCheck, Star } from "lucide-react";
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
  rating?: number;
  ratingCount?: number;
  bookings?: number;
  badge?: "popular" | "new" | null;
  verified?: boolean;
  lang: Lang;
  onBook: () => void;
  onDetails?: () => void;
}

const HERO_MAP: Record<string, string> = {
  THRESHER: "/images/services/thresher.jpg", // Marai Jontro.jpg — no mistake
  SOIL_TESTING: "/images/services/soil-test.jpg", // মাটি পরীক্ষা.jpg
  POWER_TILLER: "/images/services/power-tiller.jpg", // পাওয়ার টিলার.jpg
  LAND_LEVELLER: "/images/services/land-leveller.png", // ল্যান্ড লেভেলার.png — exact
  DRONE: "/images/services/drone.jpg", // ড্রোন স্প্রেয়িং.jpg
  COMBINE_HARVESTER: "/images/services/combine.jpg", // কম্বাইন হারভেস্টার.jpg
  AGRONOMIST: "/images/services/agronomist.jpg", // কৃষিবিদ ভিজিট.jpg
  TRACTOR: "/images/services/tractor.jpg", // ট্রাক্টর চাষ.jpg
};

export function ServiceCard({ title, category, pricePaisa, priceUnit, rating=4.9, ratingCount=1200, bookings=3400, badge=null, verified=false, lang, onBook, onDetails }: Props) {
  const hero = HERO_MAP[category] ?? HERO_MAP.TRACTOR;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ type:"spring", stiffness: 340, damping: 28 }}
      whileHover={{ y: -4, scale: 1.01 }}
      whileTap={{ scale: 0.97 }}
      className="group flex flex-col overflow-hidden rounded-[20px] border border-[#E7E5E4] bg-white shadow-card transition-shadow hover:shadow-cardHover hover:border-[#DCFCE7] focus-within:ring-2 focus-within:ring-[#15803D] focus-within:ring-offset-2"
    >
      {/* Hero photographic — 100% realistic, relevant to service */}
      <div className="relative h-[148px] w-full overflow-hidden bg-[#F8FAF7]">
        <img src={hero} alt="" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.opacity="0")} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/20 via-transparent to-transparent" aria-hidden />
        {/* IconBox floating over hero */}
        <div className="absolute bottom-3 left-3 rounded-[14px] bg-white p-1 shadow-sm ring-1 ring-black/5">
          <AgriIconBox category={category} size={40} />
        </div>
        <div className="absolute right-3 top-3 flex gap-1.5">
          {badge==="popular" && <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800 shadow-sm">জনপ্রিয়</span>}
          {badge==="new" && <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-bold text-sky-700 shadow-sm">নতুন</span>}
          {verified && <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white text-sky-600 shadow-sm ring-1 ring-sky-200" title={lang==="bn"?"যাচাইকৃত":"Verified"}><ShieldCheck className="h-4 w-4" /></span>}
        </div>
        <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2 py-1 text-[11px] font-semibold text-[#1A1F1C] shadow-sm backdrop-blur">
          <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden /> {rating.toFixed(1)} <span className="font-normal text-[#78716C]">({(ratingCount/1000).toFixed(1)}k)</span>
        </span>
      </div>

      <div className="flex flex-1 flex-col p-5">
      {/* Row2: Title + meta */}
      <h3 className="mt-3 line-clamp-1 text-[16px] font-bold leading-6 text-[#1A1F1C] text-balance">{title}</h3>
      <p className="mt-1 flex items-center gap-1.5 text-[12px] leading-4 text-[#78716C]">
        <span>{serviceCategoryLabel(category, lang)}</span>
        <span aria-hidden>•</span>
        <Clock className="h-3 w-3" aria-hidden />
        <span>{lang==="bn" ? "২ ঘণ্টা" : "2 hrs"}</span>
      </p>

      <div className="my-3 h-px bg-[#F5F5F4]" aria-hidden />

      {/* Row3: Price + bookings (rating already in hero) */}
      <div className="flex items-end justify-between gap-2">
        <div className="flex items-baseline gap-1">
          <span className="text-[18px] font-bold tabular-nums leading-none text-[#1A1F1C]">{formatBDT(pricePaisa, lang)}</span>
          <span className="text-[12px] font-normal text-[#78716C]">{priceUnitLabel(priceUnit, lang)}</span>
        </div>
        <span className="text-[12px] font-medium text-[#57534E]">
          {(bookings/1000).toFixed(1)}k {lang==="bn"?"বুকড":"booked"}
        </span>
      </div>

      {/* Row4: Dual CTA */}
      <div className="mt-4 flex gap-2">
        <button
          onClick={onDetails}
          className="flex-1 rounded-[12px] border border-[#E7E5E4] bg-white px-3 py-2.5 text-[13px] font-semibold text-[#14532D] hover:border-[#DCFCE7] hover:bg-[#F0FDF4] active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D]"
        >
          {t("viewDetails", lang)}
        </button>
        <motion.button
          whileTap={{ scale: 0.97 }}
          onClick={onBook}
          className="flex flex-[1.2] items-center justify-center gap-1.5 rounded-[12px] bg-[#15803D] px-4 py-2.5 text-[14px] font-bold text-white shadow-button hover:bg-[#14532D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#15803D] focus-visible:ring-offset-2"
        >
          {t("bookNow", lang)} <span aria-hidden>→</span>
        </motion.button>
      </div>
      </div>
    </motion.div>
  );
}

export function ServiceCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-[20px] border border-[#E7E5E4] bg-white shadow-card">
      <div className="h-[148px] w-full animate-pulse bg-[#F5F5F4]" />
      <div className="p-5">
        <div className="h-5 w-3/4 animate-pulse rounded bg-[#F5F5F4]" />
        <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-[#F5F5F4]" />
        <div className="my-3 h-px bg-[#F5F5F4]" />
        <div className="flex justify-between">
          <div className="h-5 w-20 animate-pulse rounded bg-[#F5F5F4]" />
          <div className="h-4 w-24 animate-pulse rounded bg-[#F5F5F4]" />
        </div>
        <div className="mt-4 flex gap-2">
          <div className="h-10 flex-1 animate-pulse rounded-[12px] bg-[#F5F5F4]" />
          <div className="h-10 flex-[1.2] animate-pulse rounded-[12px] bg-[#DCFCE7]" />
        </div>
      </div>
    </div>
  );
}
