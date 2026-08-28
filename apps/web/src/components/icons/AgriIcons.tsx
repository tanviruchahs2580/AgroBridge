import { Tractor, Plane, FlaskConical, Wrench, Leaf, Sprout, Clock, ShieldCheck, Star, Calendar, Phone, Eye, ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

// Duotone icon box — Gap Analysis §4.5
// Style: 48x48, radius 14px, border 1px, stroke 1.75px, duotone fill 20%

type Category = "AGRONOMIST"|"COMBINE_HARVESTER"|"DRONE"|"LAND_LEVELLER"|"POWER_TILLER"|"SOIL_TESTING"|"THRESHER"|"TRACTOR";

const CATEGORY_STYLE: Record<Category, { bg: string; border: string; icon: string }> = {
  AGRONOMIST:       { bg: "bg-[#F0F9FF]", border: "border-[#BAE6FD]", icon: "text-[#0284C7]" },
  DRONE:            { bg: "bg-[#F0F9FF]", border: "border-[#BAE6FD]", icon: "text-[#0284C7]" },
  TRACTOR:          { bg: "bg-[#FFF7ED]", border: "border-[#FDBA74]", icon: "text-[#EA580C]" },
  COMBINE_HARVESTER:{ bg: "bg-[#FFF7ED]", border: "border-[#FDBA74]", icon: "text-[#EA580C]" },
  POWER_TILLER:     { bg: "bg-[#FFF7ED]", border: "border-[#FDBA74]", icon: "text-[#EA580C]" },
  THRESHER:         { bg: "bg-[#FFF7ED]", border: "border-[#FDBA74]", icon: "text-[#EA580C]" },
  LAND_LEVELLER:    { bg: "bg-[#FEFCE8]", border: "border-[#FDE68A]", icon: "text-[#CA8A04]" },
  SOIL_TESTING:     { bg: "bg-[#FDF6EE]", border: "border-[#FDE68A]", icon: "text-[#92400E]" },
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
      className={`flex shrink-0 items-center justify-center rounded-[14px] border ${style.bg} ${style.border} ${withMotion ? "transition group-hover:scale-[1.05]" : ""}`}
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
    star: <Star className={`h-3 w-3 fill-amber-400 text-amber-400 ${className}`} />,
    clock: <Clock className={`h-3 w-3 ${className}`} />,
    shield: <ShieldCheck className={`h-3 w-3 ${className}`} />,
    calendar: <Calendar className={`h-3 w-3 ${className}`} />,
    phone: <Phone className={`h-3 w-3 ${className}`} />,
    eye: <Eye className={`h-3 w-3 ${className}`} />,
    arrow: <ArrowRight className={`h-3.5 w-3.5 ${className}`} />,
  };
  return <>{map[icon]}</>;
}
