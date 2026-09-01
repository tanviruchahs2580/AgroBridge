// Raw enum/string → localized label helpers (single source of truth per axis).
import { t } from "./i18n.js";
import type { DictKey, Lang } from "./i18n.js";

function fromMap(map: Record<string, DictKey>, raw: string, lang: Lang): string {
  const key = map[raw];
  return key ? t(key, lang) : raw;
}

// ── Crops ──
const CROP_KEYS: Record<string, DictKey> = {
  RICE: "cropRICE", WHEAT: "cropWHEAT", JUTE: "cropJUTE",
  MUSTARD: "cropMUSTARD", MAIZE: "cropMAIZE", POTATO: "cropPOTATO",
};
export const cropLabel = (raw: string, lang: Lang): string => fromMap(CROP_KEYS, raw, lang);

// ── Crop cycle stages ──
const STAGE_KEYS: Record<string, DictKey> = {
  SEED: "stageSEED", GERMINATION: "stageGERMINATION", VEGETATIVE: "stageVEGETATIVE",
  FLOWERING: "stageFLOWERING", GRAIN_FRUIT_DEVELOPMENT: "stageGRAIN_FRUIT_DEVELOPMENT", HARVEST: "stageHARVEST",
};
export const stageLabel = (raw: string, lang: Lang): string => fromMap(STAGE_KEYS, raw, lang);

// ── Marketplace product categories ──
const CATEGORY_KEYS: Record<string, DictKey> = {
  SEED: "catSEED", FERTILIZER: "catFERTILIZER", BIO_INPUT: "catBIO_INPUT",
  CROP_PROTECTION: "catCROP_PROTECTION", EQUIPMENT: "catEQUIPMENT",
};
export const categoryLabel = (raw: string, lang: Lang): string => fromMap(CATEGORY_KEYS, raw, lang);

// ── Service categories ──
const SERVICE_CATEGORY_KEYS: Record<string, DictKey> = {
  DRONE: "svcDRONE", TRACTOR: "svcTRACTOR", COMBINE_HARVESTER: "svcCOMBINE_HARVESTER",
  RICE_TRANSPLANTER: "svcRICE_TRANSPLANTER", POWER_TILLER: "svcPOWER_TILLER",
  LAND_LEVELLER: "svcLAND_LEVELLER", THRESHER: "svcTHRESHER", SOIL_TESTING: "svcSOIL_TESTING",
  AGRONOMIST: "svcAGRONOMIST", OTHER: "svcOTHER",
};
export const serviceCategoryLabel = (raw: string, lang: Lang): string => fromMap(SERVICE_CATEGORY_KEYS, raw, lang);

// ── Service price units ──
const PRICE_UNIT_KEYS: Record<string, DictKey> = {
  PER_BIGHA: "unitPER_BIGHA", PER_ACRE: "unitPER_ACRE", PER_HOUR: "unitPER_HOUR", PER_DAY: "unitPER_DAY",
  PER_VISIT: "unitPER_VISIT", PER_SAMPLE: "unitPER_SAMPLE", PER_MAUND: "unitPER_MAUND", PER_KG: "unitPER_KG",
};
export function priceUnitLabel(raw: string, lang: Lang): string {
  const key = PRICE_UNIT_KEYS[raw];
  if (key) return t(key, lang);
  return raw.startsWith("PER_") ? `/ ${raw.slice(4).toLowerCase()}` : `/${raw.toLowerCase()}`;
}

// ── Booking statuses ──
const BOOKING_STATUS_KEYS: Record<string, DictKey> = {
  REQUESTED: "bsREQUESTED", ASSIGNED: "bsASSIGNED", IN_PROGRESS: "bsIN_PROGRESS",
  COMPLETED: "bsCOMPLETED", CANCELLED: "statusCANCELLED",
};
export const bookingStatusLabel = (raw: string, lang: Lang): string => fromMap(BOOKING_STATUS_KEYS, raw, lang);

// ── Procurement pipeline (stepper + badges) ──
const PROC_STATUS_KEYS: Record<string, DictKey> = {
  SUBMITTED: "pipeSUBMITTED", QC: "pipeQC", PURCHASE_ORDER: "pipePO",
  COLLECTED: "pipeCOLLECTED", PAID: "pipePAID", REJECTED: "statusREJECTED",
};
export const procurementStatusLabel = (raw: string, lang: Lang): string => fromMap(PROC_STATUS_KEYS, raw, lang);
export const PROC_PIPELINE = ["SUBMITTED", "QC", "PURCHASE_ORDER", "COLLECTED", "PAID"] as const;

// ── Withdrawal / generic approval statuses ──
const WD_STATUS_KEYS: Record<string, DictKey> = {
  PENDING: "statusPENDING", APPROVED: "statusAPPROVED", REJECTED: "statusREJECTED", PAID: "statusPAID",
};
export const withdrawalStatusLabel = (raw: string, lang: Lang): string => fromMap(WD_STATUS_KEYS, raw, lang);

// ── Withdrawal channels ──
const CHANNEL_KEYS: Record<string, DictKey> = {
  BKASH: "withdrawMethodBKASH", NAGAD: "withdrawMethodNAGAD", BANK: "withdrawMethodBANK",
};
export const channelLabel = (raw: string, lang: Lang): string => fromMap(CHANNEL_KEYS, raw, lang);

// ── User account status ──
const USER_STATUS_KEYS: Record<string, DictKey> = {
  ACTIVE: "statusACTIVE", SUSPENDED: "statusSUSPENDED", DISABLED: "statusDISABLED",
};
export const userStatusLabel = (raw: string, lang: Lang): string => fromMap(USER_STATUS_KEYS, raw, lang);

// ── Roles ──
const ROLE_KEYS: Record<string, DictKey> = {
  FARMER: "roleFARMER", QC_OFFICER: "roleQC_OFFICER", ADMIN: "roleADMIN", SUPER_ADMIN: "roleSUPER_ADMIN",
  SERVICE_PROVIDER: "roleSERVICE_PROVIDER",
};
export const roleLabel = (raw: string, lang: Lang): string => fromMap(ROLE_KEYS, raw, lang);

// ── Wallet transaction reasons (free-text on the API; prefix-matched) ──
const REASON_PREFIXES: [RegExp, DictKey][] = [
  [/^(top-?up|টাকা যোগ)/i, "walletTOPUP"],
  [/^(withdrawal|উইথড্র|উত্তোলন)/i, "walletWITHDRAWAL"],
  [/^(payment|পেমেন্ট)/i, "walletPAYMENT"],
  [/^(procurement|ফসলের|বিক্রয়)/i, "walletSALE_PROCEEDS"],
  [/^(refund|ফেরত)/i, "walletREFUND"],
  [/^(membership|মেম্বারশিপ)/i, "walletMEMBERSHIP_FEE"],
];
export function reasonLabel(raw: string, lang: Lang): string {
  for (const [re, key] of REASON_PREFIXES) {
    if (re.test(raw.trim())) return t(key, lang);
  }
  return raw;
}

// ── Weather risk types → paired ACTION line keys ──
const WEATHER_RISK_KEYS: Record<string, DictKey> = {
  SPRAY_WARNING: "weatherRiskSPRAY_WARNING",
  RAIN_WARNING: "weatherRiskRAIN_WARNING",
  HEAT_WARNING: "weatherRiskHEAT_WARNING",
  IRRIGATION_ADVICE: "weatherRiskIRRIGATION_ADVICE",
  DISEASE_RISK: "weatherRiskDISEASE_RISK",
  INFO: "weatherRiskINFO",
};
export const weatherRiskActionLabel = (type: string, lang: Lang): string | null => {
  const key = WEATHER_RISK_KEYS[type];
  return key ? t(key, lang) : null;
};

// ── Notification category tabs ──
const NOTIF_CATEGORY_KEYS: Record<string, DictKey> = {
  CRITICAL: "notifCategoryCRITICAL", ACTION: "notifCategoryACTION", INFO: "notifCategoryINFO",
};
export const notifCategoryLabel = (raw: string, lang: Lang): string => fromMap(NOTIF_CATEGORY_KEYS, raw, lang);
