/** STEP 59: Bengali plural rules via Intl.PluralRules("bn") */
const bnRules = new Intl.PluralRules("bn");
const enRules = new Intl.PluralRules("en");

/** Return the plural category for a count in the given locale. */
export function pluralCategory(count: number, lang: "bn" | "en" = "bn"): Intl.LDMLPluralRule {
  return (lang === "bn" ? bnRules : enRules).select(count);
}

/** Format cart item count with correct Bengali plural form. */
export function formatCartCount(count: number, lang: "bn" | "en"): string {
  // t("cartItemsCount") is "কার্ট ({n})" — but for proper plural we choose form
  // bn: one = singular, other = plural (e.g. 1 টি পণ্য vs N টি পণ্য)
  const cat = pluralCategory(count, lang);
  if (lang === "bn") {
    // Keep existing i18n key but annotate count with plural-aware suffix if needed
    // For demo: bn one => "১টি পণ্য", other => "{n}টি পণ্য"
    // We delegate to t() via caller, but provide helper to choose key
    return cat === "one" ? `${count}টি পণ্য` : `${count}টি পণ্য`;
  }
  return cat === "one" ? `${count} item` : `${count} items`;
}

/** Generic helper: choose string by plural category. */
export function pluralPick<T>(count: number, forms: Record<Intl.LDMLPluralRule, T>, lang: "bn" | "en" = "bn"): T {
  const cat = pluralCategory(count, lang);
  return forms[cat] ?? forms.other;
}

/** For notifications: "X unread" with bn plural */
export function formatUnreadCount(count: number, lang: "bn" | "en"): string {
  const cat = pluralCategory(count, lang);
  if (lang === "bn") {
    return cat === "one" ? `${count}টি অপঠিত` : `${count}টি অপঠিত`;
  }
  return cat === "one" ? `${count} unread` : `${count} unread`;
}

export { bnRules, enRules };
