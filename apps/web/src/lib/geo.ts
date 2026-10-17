/**
 * Weather coordinates.
 *
 * Weather for a farmer is resolved from their own area without asking for a
 * device-location permission: a profile district maps to its administrative
 * division and the division centre is used. That is the right resolution for
 * agricultural advisories (weather services forecast on regional grids), it
 * works inside the Android APK — where `navigator.geolocation` fails unless the
 * app declares location permissions — and it means the app never has to declare
 * or request location access in Google Play.
 */

/** The eight administrative divisions, with the coordinates of their centres. */
const DIVISION_COORDS: Record<string, { lat: number; lng: number }> = {
  DHAKA: { lat: 23.8103, lng: 90.4125 },
  CHATTOGRAM: { lat: 22.3569, lng: 91.7832 },
  RAJSHAHI: { lat: 24.3745, lng: 88.6042 },
  KHULNA: { lat: 22.8098, lng: 89.5644 },
  BARISHAL: { lat: 22.701, lng: 90.3711 },
  SYLHET: { lat: 24.8949, lng: 91.8687 },
  RANGPUR: { lat: 25.7439, lng: 89.2752 },
  MYMENSINGH: { lat: 24.7471, lng: 90.4203 },
};

/** District → division. Keys are lowercase English or the Bengali name. */
const DISTRICT_DIVISION: Record<string, keyof typeof DIVISION_COORDS> = {
  // Dhaka division
  dhaka: "DHAKA", gazipur: "DHAKA", narayanganj: "DHAKA", narsingdi: "DHAKA", manikganj: "DHAKA",
  munshiganj: "DHAKA", tangail: "DHAKA", kishoreganj: "DHAKA", faridpur: "DHAKA", gopalganj: "DHAKA",
  madaripur: "DHAKA", shariatpur: "DHAKA", rajbari: "DHAKA",
  // Chattogram division
  chattogram: "CHATTOGRAM", chittagong: "CHATTOGRAM", coxsbazar: "CHATTOGRAM", "cox's bazar": "CHATTOGRAM",
  comilla: "CHATTOGRAM", cumilla: "CHATTOGRAM", brahmanbaria: "CHATTOGRAM", chandpur: "CHATTOGRAM",
  feni: "CHATTOGRAM", noakhali: "CHATTOGRAM", lakshmipur: "CHATTOGRAM", rangamati: "CHATTOGRAM",
  bandarban: "CHATTOGRAM", khagrachhari: "CHATTOGRAM",
  // Rajshahi division
  rajshahi: "RAJSHAHI", bogura: "RAJSHAHI", bogra: "RAJSHAHI", joypurhat: "RAJSHAHI", naogaon: "RAJSHAHI",
  natore: "RAJSHAHI", nawabganj: "RAJSHAHI", chapainawabganj: "RAJSHAHI", pabna: "RAJSHAHI", sirajganj: "RAJSHAHI",
  // Khulna division
  khulna: "KHULNA", bagerhat: "KHULNA", chuadanga: "KHULNA", jashore: "KHULNA", jessore: "KHULNA",
  jhenaidah: "KHULNA", kushtia: "KHULNA", magura: "KHULNA", meherpur: "KHULNA", narail: "KHULNA", satkhira: "KHULNA",
  // Barishal division
  barishal: "BARISHAL", barisal: "BARISHAL", barguna: "BARISHAL", bhola: "BARISHAL", jhalokati: "BARISHAL",
  patuakhali: "BARISHAL", pirojpur: "BARISHAL",
  // Sylhet division
  sylhet: "SYLHET", habiganj: "SYLHET", moulvibazar: "SYLHET", sunamganj: "SYLHET",
  // Rangpur division
  rangpur: "RANGPUR", dinajpur: "RANGPUR", gaibandha: "RANGPUR", kurigram: "RANGPUR", lalmonirhat: "RANGPUR",
  nilphamari: "RANGPUR", panchagarh: "RANGPUR", thakurgaon: "RANGPUR",
  // Mymensingh division
  mymensingh: "MYMENSINGH", jamalpur: "MYMENSINGH", netrokona: "MYMENSINGH", sherpur: "MYMENSINGH",
  // Bengali spellings (profiles are often filled in Bengali)
  ঢাকা: "DHAKA", গাজীপুর: "DHAKA", নারায়ণগঞ্জ: "DHAKA", টাঙ্গাইল: "DHAKA", কিশোরগঞ্জ: "DHAKA",
  চট্টগ্রাম: "CHATTOGRAM", কক্সবাজার: "CHATTOGRAM", কুমিল্লা: "CHATTOGRAM", ফেনী: "CHATTOGRAM", নোয়াখালী: "CHATTOGRAM",
  রাজশাহী: "RAJSHAHI", বগুড়া: "RAJSHAHI", নওগাঁ: "RAJSHAHI", পাবনা: "RAJSHAHI", সিরাজগঞ্জ: "RAJSHAHI",
  খুলনা: "KHULNA", যশোর: "KHULNA", কুষ্টিয়া: "KHULNA", সাতক্ষীরা: "KHULNA", ঝিনাইদহ: "KHULNA",
  বরিশাল: "BARISHAL", ভোলা: "BARISHAL", পটুয়াখালী: "BARISHAL",
  সিলেট: "SYLHET", হবিগঞ্জ: "SYLHET", মৌলভীবাজার: "SYLHET", সুনামগঞ্জ: "SYLHET",
  রংপুর: "RANGPUR", দিনাজপুর: "RANGPUR", গাইবান্ধা: "RANGPUR", কুড়িগ্রাম: "RANGPUR", নীলফামারী: "RANGPUR",
  ময়মনসিংহ: "MYMENSINGH", জামালপুর: "MYMENSINGH", নেত্রকোণা: "MYMENSINGH", শেরপুর: "MYMENSINGH",
};

/**
 * Fallback when the profile has no district yet: the national centre. Callers
 * pair this with a hint asking the farmer to set their district for localised
 * advice, so the generic result is never presented as local.
 */
const DEFAULT_COORDS = DIVISION_COORDS.DHAKA;

/** Normalise a free-text district for lookup (trim, lowercase, collapse spaces). */
function normalizeDistrict(district: string): string {
  return district.trim().toLowerCase().replace(/\s+/g, " ");
}

/** True when the district resolved to a real division (i.e. advice is localised). */
export function isDistrictResolved(district?: string | null): boolean {
  if (!district) return false;
  return Boolean(DISTRICT_DIVISION[normalizeDistrict(district)]);
}

/**
 * Coordinates for weather lookups: the division centre of the given district
 * when it is known, otherwise the national default. Never fails, never prompts
 * for a permission, never blocks rendering.
 */
export function getWeatherCoords(district?: string | null): { lat: number; lng: number } {
  if (!district) return DEFAULT_COORDS;
  const division = DISTRICT_DIVISION[normalizeDistrict(district)];
  return division ? DIVISION_COORDS[division] : DEFAULT_COORDS;
}
