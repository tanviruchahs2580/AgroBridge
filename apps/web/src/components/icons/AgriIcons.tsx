import { Tractor, Plane, FlaskConical, Wrench, Leaf, Sprout, Clock, ShieldCheck, Star, Calendar, Phone, Eye, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

// Duotone icon box — Gap Analysis §4.5
// Style: 48x48, radius 14px, border 1px, stroke 1.75px, duotone fill 20%

type Category = "AGRONOMIST"|"COMBINE_HARVESTER"|"DRONE"|"LAND_LEVELLER"|"POWER_TILLER"|"SOIL_TESTING"|"THRESHER"|"TRACTOR";

const CATEGORY_STYLE: Record<Category, { bg: string; border: string; icon: string }> = {
  AGRONOMIST:       { bg: "bg-sky-50", border: "border-sky-200", icon: "text-sky-600" },
  DRONE:            { bg: "bg-sky-50", border: "border-sky-200", icon: "text-sky-600" },
  TRACTOR:          { bg: "bg-orange-50", border: "border-warning-border", icon: "text-orange-600" },
  COMBINE_HARVESTER:{ bg: "bg-orange-50", border: "border-warning-border", icon: "text-orange-600" },
  POWER_TILLER:     { bg: "bg-orange-50", border: "border-warning-border", icon: "text-orange-600" },
  THRESHER:         { bg: "bg-orange-50", border: "border-warning-border", icon: "text-orange-600" },
  LAND_LEVELLER:    { bg: "bg-enterprise-earth-50", border: "border-warning-border", icon: "text-warning-text" },
  SOIL_TESTING:     { bg: "bg-enterprise-soil-50", border: "border-warning-border", icon: "text-enterprise-earth" },
};

function IconForCategory({ category, size=22 }: { category: string; size?: number }) {
  const props = { size, strokeWidth: 1.75 } as const;
  switch (category) {
    case "DRONE": return <Plane {...props} />;
    case "TRACTOR": return <Tractor {...props} />;
    case "COMBINE_HARVESTER": return <Tractor {...props} />; // fallback, custom combine below
    case "POWER_TILLER": return <Tractor {...props} />;
    case "LAND_LEVELLER": return <Wrench {...props} />;
    case "SOIL_TESTING": return <FlaskConical {...props} />;
    case "THRESHER": return <Wrench {...props} />;
    case "AGRONOMIST": return <Leaf {...props} />;
    default: return <Sprout {...props} />;
  }
}

// Custom tractor/combine duotone fallback — if lucide missing, use Tractor with accent
export function AgriIconBox({ category, size=48, withMotion=true }: { category: string; size?: number; withMotion?: boolean }) {
  const cat = (CATEGORY_STYLE[category as Category] ? category : "TRACTOR") as Category;
  const style = CATEGORY_STYLE[cat] ?? CATEGORY_STYLE.TRACTOR;
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-iconBox border ${style.bg} ${style.border} ${withMotion ? "transition group-hover:scale-[1.05]" : ""}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <span className={style.icon}>
        <IconForCategory category={cat} size={size===48?22:18} />
      </span>
    </div>
  );
}

export function MetaIcon({ icon, className="" }: { icon: "star"|"clock"|"shield"|"calendar"|"phone"|"eye"|"arrow"; className?: string }) {
  const map: Record<string, ReactNode> = {
    star: <Star className={`h-3 w-3 fill-enterprise-warning text-enterprise-warning ${className}`} />,
    clock: <Clock className={`h-3 w-3 ${className}`} />,
    shield: <ShieldCheck className={`h-3 w-3 ${className}`} />,
    calendar: <Calendar className={`h-3 w-3 ${className}`} />,
    phone: <Phone className={`h-3 w-3 ${className}`} />,
    eye: <Eye className={`h-3 w-3 ${className}`} />,
    arrow: <ArrowRight className={`h-3.5 w-3.5 ${className}`} />,
  };
  return <>{map[icon]}</>;
}

/**
 * Rice-ear medallion (চলমান ফসল card) — hand-drawn duotone panicle:
 * curved stalk + drooping grain branches, brand-token colors only so it
 * adapts to light/dark themes. Decorative (aria-hidden); the crop name is
 * rendered as real text next to it.
 */
export function RiceEarMedallion({ size = 92 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="relative inline-flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: size,
        height: size,
        background: "radial-gradient(circle at 32% 28%, var(--color-brand-100) 0%, var(--color-brand-50) 62%, var(--color-surface-card) 100%)",
        boxShadow: "inset 0 0 0 1.5px var(--color-brand-200), 0 8px 22px -8px rgba(21,128,61,0.35)",
      }}
    >
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 48 48" fill="none" style={{ display: "block" }}>
        {/* stalk */}
        <path d="M24 45c0-9 1-17 4-24" stroke="var(--color-brand-700)" strokeWidth="2.4" strokeLinecap="round" />
        {/* leaf */}
        <path d="M25.5 33c-5.5-1.5-9-5-10-9.5 5 .5 8.8 3.6 10 9.5Z" fill="var(--color-brand-500)" opacity="0.55" />
        {/* panicle branches */}
        <path d="M28 21c-2-3.5-6-5.5-10.5-5.5" stroke="var(--color-brand-600)" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M28.6 17.5c-.8-3.6-3.6-6.4-7.4-7.6" stroke="var(--color-brand-600)" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M29 14c.6-3.6 3-6.6 6.4-8.2" stroke="var(--color-brand-600)" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M28.4 24.5c1.8-3 5-4.8 8.6-5" stroke="var(--color-brand-600)" strokeWidth="1.6" strokeLinecap="round" />
        {/* grains (paddy) */}
        <g fill="var(--color-brand-600)">
          <ellipse cx="16.5" cy="15" rx="2.6" ry="1.7" transform="rotate(-24 16.5 15)" />
          <ellipse cx="20.4" cy="9.4" rx="2.6" ry="1.7" transform="rotate(-38 20.4 9.4)" />
          <ellipse cx="26.9" cy="5" rx="2.6" ry="1.7" transform="rotate(28 26.9 5)" />
          <ellipse cx="37.5" cy="19" rx="2.6" ry="1.7" transform="rotate(12 37.5 19)" />
        </g>
        <g fill="var(--color-brand-400)">
          <ellipse cx="13.6" cy="16.6" rx="2.4" ry="1.6" transform="rotate(-24 13.6 16.6)" />
          <ellipse cx="17.6" cy="11.4" rx="2.4" ry="1.6" transform="rotate(-38 17.6 11.4)" />
          <ellipse cx="24.6" cy="6.6" rx="2.4" ry="1.6" transform="rotate(14 24.6 6.6)" />
          <ellipse cx="30.4" cy="4.4" rx="2.4" ry="1.6" transform="rotate(40 30.4 4.4)" />
          <ellipse cx="34.4" cy="10" rx="2.4" ry="1.6" transform="rotate(56 34.4 10)" />
          <ellipse cx="35.4" cy="15.4" rx="2.4" ry="1.6" transform="rotate(8 35.4 15.4)" />
          <ellipse cx="39.4" cy="22.4" rx="2.4" ry="1.6" transform="rotate(20 39.4 22.4)" />
        </g>
      </svg>
    </span>
  );
}
