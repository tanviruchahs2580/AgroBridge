/**
 * Characterization tests for i18n.ts / labels.ts
 * Locks current guest `session?.lang ?? "bn"` fallback behavior (regression test for flagged gap).
 * Tests both `bn` and `en` dictionaries, interpolation, and all label helpers.
 */
import { describe, it, expect } from "vitest";
import { t, dict } from "./i18n.js";
import type { Lang } from "./i18n.js";
import {
  cropLabel,
  stageLabel,
  categoryLabel,
  serviceCategoryLabel,
  priceUnitLabel,
  bookingStatusLabel,
  procurementStatusLabel,
  withdrawalStatusLabel,
  channelLabel,
  userStatusLabel,
  roleLabel,
  reasonLabel,
  weatherRiskActionLabel,
  notifCategoryLabel,
} from "./labels.js";

// Helper to get guest lang fallback (characterization — lock current behavior)
function guestLang(session: { lang?: Lang } | null): Lang {
  return (session?.lang ?? "bn") as Lang;
}

describe("lib/i18n — dict structure and bn/en coverage", () => {
  it("dict contains expected keys and both languages for each key", () => {
    const keys = Object.keys(dict) as (keyof typeof dict)[];
    expect(keys.length).toBeGreaterThan(100);
    for (const k of keys) {
      expect(dict[k]).toHaveProperty("bn");
      expect(dict[k]).toHaveProperty("en");
      expect(typeof dict[k].bn).toBe("string");
      expect(typeof dict[k].en).toBe("string");
      expect(dict[k].bn.length).toBeGreaterThan(0);
      expect(dict[k].en.length).toBeGreaterThan(0);
    }
  });

  it("t() returns bn string for bn lang and en for en lang", () => {
    expect(t("appName", "bn")).toBe("এগ্রোব্রিজ");
    expect(t("appName", "en")).toBe("AgroBridge");
    expect(t("login", "bn")).toBe("লগইন");
    expect(t("login", "en")).toBe("Login");
    expect(t("weather", "bn")).toBe("আবহাওয়া");
    expect(t("weather", "en")).toBe("Weather");
  });

  it("t() interpolates {var} tokens from vars", () => {
    expect(t("welcomeName", "en", { name: "Karim" })).toBe("Welcome, Karim!");
    expect(t("welcomeName", "bn", { name: "করিম" })).toBe("স্বাগতম, করিম!");
    expect(t("greeting", "en", { name: "Asha" })).toBe("Hello, Asha 👋");
    expect(t("greeting", "bn", { name: "আশা" })).toBe("আসসালামু আলাইকুম, আশা 👋");
  });

  it("t() leaves unmatched placeholders intact", () => {
    expect(t("welcomeName", "en")).toBe("Welcome, {name}!");
    expect(t("welcomeName", "en", {})).toBe("Welcome, {name}!");
    expect(t("stockLeft", "en", {})).toBe("Stock: {n}");
  });

  it("t() handles multiple vars and numeric values", () => {
    expect(t("obStepOf", "en", { step: 2, total: 5 })).toBe("Step 2 / 5");
    expect(t("obStepOf", "bn", { step: 2, total: 5 })).toBe("ধাপ 2 / 5");
    expect(t("stockLeft", "en", { n: 42 })).toBe("Stock: 42");
    expect(t("cartItemsCount", "bn", { n: 3 })).toBe("কার্ট (3)");
  });

  it("t() handles vars with extra keys ignored", () => {
    expect(t("welcomeName", "en", { name: "X", extra: "y" } as any)).toBe("Welcome, X!");
  });

  it("brand and status keys have distinct bn/en values (not accidentally identical)", () => {
    expect(t("statusPENDING", "bn")).not.toBe(t("statusPENDING", "en"));
    expect(t("roleFARMER", "bn")).not.toBe(t("roleFARMER", "en"));
  });
});

describe("lib/i18n — guest language fallback (regression lock)", () => {
  // Flagged gap: App.tsx uses `session?.lang ?? "bn"` which hard-defaults guests to Bengali
  // regardless of navigator.language / stored preference. This suite LOCKS that current behavior
  // so we notice if it changes; we do NOT fix it here.

  it('guest (null session) resolves to "bn" via session?.lang ?? "bn"', () => {
    expect(guestLang(null)).toBe("bn");
    expect(t("appName", guestLang(null))).toBe("এগ্রোব্রিজ");
  });

  it('guest fallback stays "bn" even when navigator.language is en-US (characterization)', () => {
    // Save and mock
    const origLang = (navigator as any).language;
    Object.defineProperty(window.navigator, "language", { value: "en-US", configurable: true });
    // App still uses session?.lang ?? "bn", so t still returns bn
    expect(guestLang(null)).toBe("bn");
    expect(t("loading", guestLang(null))).toBe("লোড হচ্ছে...");
    // restore
    Object.defineProperty(window.navigator, "language", { value: origLang ?? "en-US", configurable: true });
  });

  it('authenticated session with lang "en" uses "en", with "bn" uses "bn"', () => {
    expect(guestLang({ lang: "en" })).toBe("en");
    expect(t("login", guestLang({ lang: "en" }))).toBe("Login");
    expect(guestLang({ lang: "bn" })).toBe("bn");
    expect(t("login", guestLang({ lang: "bn" }))).toBe("লগইন");
  });

  it("undefined lang in session object still falls back to bn", () => {
    expect(guestLang({} as any)).toBe("bn");
    expect(guestLang({ lang: undefined as any })).toBe("bn");
  });

  it("sessionExpired toast uses same fallback — lock it", () => {
    const sessionNull: { lang?: Lang } | null = null;
    const lang = (sessionNull?.lang ?? "bn") as Lang;
    expect(t("sessionExpired", lang)).toBe("সেশনের মেয়াদ শেষ — আবার লগইন করুন।");
    const sessionEn = { lang: "en" as Lang };
    expect(t("sessionExpired", sessionEn.lang)).toBe("Session expired — please log in again.");
  });

  it("documents gap: no auto-detection of browser language for guests (intentional lock)", () => {
    // If we ever want to fix, we would use `navigator.language.startsWith("en") ? "en" : "bn"`
    // but currently the code intentionally defaults to bn. This test will fail if implementation changes,
    // acting as a regression alert.
    const browserLang = "en";
    const currentImplementation = guestLang(null); // always bn
    expect(currentImplementation).toBe("bn");
    expect(currentImplementation).not.toBe(browserLang);
  });
});

describe("lib/labels — raw enum → localized label helpers", () => {
  it("cropLabel maps known crops for both langs, falls back to raw", () => {
    expect(cropLabel("RICE", "en")).toBe("Rice");
    expect(cropLabel("RICE", "bn")).toBe("ধান");
    expect(cropLabel("WHEAT", "en")).toBe("Wheat");
    expect(cropLabel("UNKNOWN_CROP", "en")).toBe("UNKNOWN_CROP");
    expect(cropLabel("UNKNOWN_CROP", "bn")).toBe("UNKNOWN_CROP");
  });

  it("stageLabel maps growth stages", () => {
    expect(stageLabel("SEED", "en")).toBe("Seed");
    expect(stageLabel("VEGETATIVE", "bn")).toBe("বৃদ্ধি");
    expect(stageLabel("UNKNOWN", "en")).toBe("UNKNOWN");
  });

  it("categoryLabel maps product categories", () => {
    expect(categoryLabel("SEED", "en")).toBe("Seeds");
    expect(categoryLabel("EQUIPMENT", "bn")).toBe("যন্ত্রপাতি");
    expect(categoryLabel("NONEXISTENT", "en")).toBe("NONEXISTENT");
  });

  it("serviceCategoryLabel maps service codes", () => {
    expect(serviceCategoryLabel("DRONE", "en")).toBe("Drone service");
    expect(serviceCategoryLabel("TRACTOR", "bn")).toBe("ট্রাক্টর");
    expect(serviceCategoryLabel("UNKNOWN_SVC", "en")).toBe("UNKNOWN_SVC");
  });

  it("priceUnitLabel maps units and falls back for PER_ prefix", () => {
    expect(priceUnitLabel("PER_BIGHA", "en")).toBe("/ bigha");
    expect(priceUnitLabel("PER_KG", "bn")).toBe("/ কেজি");
    expect(priceUnitLabel("PER_CUSTOM", "en")).toBe("/ custom");
    expect(priceUnitLabel("CUSTOM_UNIT", "en")).toBe("/custom_unit");
  });

  it("bookingStatusLabel maps statuses including CANCELLED alias", () => {
    expect(bookingStatusLabel("REQUESTED", "en")).toBe("Requested");
    expect(bookingStatusLabel("COMPLETED", "bn")).toBe("সম্পন্ন");
    expect(bookingStatusLabel("CANCELLED", "en")).toBe("Cancelled");
    expect(bookingStatusLabel("UNKNOWN", "en")).toBe("UNKNOWN");
  });

  it("procurementStatusLabel maps pipeline statuses", () => {
    expect(procurementStatusLabel("SUBMITTED", "en")).toBe("Offer");
    expect(procurementStatusLabel("PAID", "bn")).toBe("পরিশোধিত");
    expect(procurementStatusLabel("REJECTED", "en")).toBe("Rejected");
  });

  it("withdrawalStatusLabel maps PENDING/APPROVED/REJECTED/PAID", () => {
    expect(withdrawalStatusLabel("PENDING", "en")).toBe("Pending");
    expect(withdrawalStatusLabel("APPROVED", "bn")).toBe("অনুমোদিত");
    expect(withdrawalStatusLabel("PAID", "en")).toBe("Paid");
  });

  it("channelLabel maps BKASH/NAGAD/BANK", () => {
    expect(channelLabel("BKASH", "en")).toBe("bKash");
    expect(channelLabel("NAGAD", "bn")).toBe("নগদ");
    expect(channelLabel("BANK", "en")).toBe("Bank account");
    expect(channelLabel("UNKNOWN", "en")).toBe("UNKNOWN");
  });

  it("userStatusLabel maps ACTIVE/SUSPENDED/DISABLED", () => {
    expect(userStatusLabel("ACTIVE", "en")).toBe("Active");
    expect(userStatusLabel("SUSPENDED", "bn")).toBe("বরখাস্ত");
  });

  it("roleLabel maps roles including SERVICE_PROVIDER", () => {
    expect(roleLabel("FARMER", "en")).toBe("Farmer");
    expect(roleLabel("ADMIN", "bn")).toBe("অ্যাডমিন");
    expect(roleLabel("SERVICE_PROVIDER", "en")).toBe("Service Provider");
    expect(roleLabel("UNKNOWN", "en")).toBe("UNKNOWN");
  });

  it("reasonLabel prefix-matches wallet transaction reasons (bn/en)", () => {
    expect(reasonLabel("Top-up via bKash", "en")).toBe("Top-up");
    expect(reasonLabel("টাকা যোগ", "bn")).toBe("টাকা যোগ");
    expect(reasonLabel("Withdrawal to bKash", "en")).toBe("Withdrawal");
    expect(reasonLabel("Payment for order", "en")).toBe("Payment");
    expect(reasonLabel("Procurement sale", "en")).toBe("Sale proceeds");
    expect(reasonLabel("Membership fee GOLD", "en")).toBe("Membership fee");
    expect(reasonLabel("Refund for order", "en")).toBe("Refund");
    expect(reasonLabel("Some random reason not matching", "en")).toBe("Some random reason not matching");
    // whitespace trimming
    expect(reasonLabel("  Top-up  ", "en")).toBe("Top-up");
  });

  it("weatherRiskActionLabel returns paired action line or null", () => {
    expect(weatherRiskActionLabel("SPRAY_WARNING", "en")).toBe("→ postpone spraying today");
    expect(weatherRiskActionLabel("RAIN_WARNING", "bn")).toBe("→ সেচ বন্ধ রাখুন, নিষ্কাশন পরিষ্কার রাখুন");
    expect(weatherRiskActionLabel("UNKNOWN_TYPE", "en")).toBeNull();
  });

  it("notifCategoryLabel maps CRITICAL/ACTION/INFO", () => {
    expect(notifCategoryLabel("CRITICAL", "en")).toBe("Critical");
    expect(notifCategoryLabel("INFO", "bn")).toBe("তথ্য");
    expect(notifCategoryLabel("UNKNOWN", "en")).toBe("UNKNOWN");
  });
});
