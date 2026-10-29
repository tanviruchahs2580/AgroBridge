/**
 * Service category → hero image, in one place.
 *
 * The same eight-entry map was written out twice — once as `HERO_MAP` in
 * ServiceCard and once inline in the booking dialog — so a new service category
 * meant remembering both, and the second copy had already drifted into an
 * immediately-invoked lookup inside JSX. One map, one fallback.
 */
const SERVICE_HERO: Readonly<Record<string, string>> = {
  THRESHER: "/images/services/thresher.jpg",
  SOIL_TESTING: "/images/services/soil-test.jpg",
  POWER_TILLER: "/images/services/power-tiller.jpg",
  LAND_LEVELLER: "/images/services/land-leveller.png",
  DRONE: "/images/services/drone.jpg",
  COMBINE_HARVESTER: "/images/services/combine.jpg",
  AGRONOMIST: "/images/services/agronomist.jpg",
  TRACTOR: "/images/services/tractor.jpg",
};

/** The tractor photo is the deliberate "unknown category" default — a service photo,
 *  never a placeholder graphic (see docs/asset-provenance.md). */
export const SERVICE_HERO_FALLBACK = "/images/services/tractor.jpg";

export const serviceHeroImage = (category: string): string => SERVICE_HERO[category] ?? SERVICE_HERO_FALLBACK;
