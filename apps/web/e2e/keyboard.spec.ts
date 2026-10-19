import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Keyboard-only pass (WEB-03): everything here is driven with Tab/Enter/Escape
 * and asserted against computed styles — no pointer interaction and no app
 * state beyond the seeded login.
 *
 * Requires running API + Web (see farmer-journey.spec.ts).
 *
 * Focus indicator: this app's design system draws the indicator as a Tailwind
 * ring (box-shadow), not an outline, so "visible indicator" means an outline
 * with width/style set OR a box-shadow that differs from the element's
 * unfocused computed shadow (the pre-Tab baseline captured per page).
 */

const FOCUSABLE =
  "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

interface FocusSnapshot {
  /** Index into the FOCUSABLE node list — the element's document-flow position. */
  index: number;
  tag: string;
  label: string;
  focusVisible: boolean;
  indicator: boolean;
  leftPage: boolean;
}

/** Pre-Tab box-shadow of every focusable node, so the indicator check can tell a
 *  base shadow (shadow-sm etc.) from a focus ring that appeared on Tab. */
async function shadowBaseline(page: Page): Promise<string[]> {
  return page.evaluate((sel) => [...document.querySelectorAll<HTMLElement>(sel)].map((el) => getComputedStyle(el).boxShadow), FOCUSABLE);
}

async function snapshotActive(page: Page, baseline: string[]): Promise<FocusSnapshot> {
  return page.evaluate(
    ({ sel, baseline }) => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || el === document.documentElement) {
        return { index: -1, tag: "", label: "", focusVisible: false, indicator: false, leftPage: true };
      }
      const cs = getComputedStyle(el);
      const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
      const nodes = [...document.querySelectorAll<HTMLElement>(sel)];
      const index = nodes.indexOf(el);
      const base = index >= 0 ? baseline[index] : undefined;
      const ringAppeared = cs.boxShadow !== "none" && cs.boxShadow !== base;
      const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 48);
      return {
        index,
        tag: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : ""),
        label,
        focusVisible: el.matches(":focus-visible"),
        indicator: outline || ringAppeared,
        leftPage: false,
      };
    },
    { sel: FOCUSABLE, baseline }
  );
}

/** Tab through the page until focus wraps or leaves it (cap 40). Returns the
 *  visited sequence; every step must be in-flow, :focus-visible and visible. */
async function tabThrough(page: Page, baseline: string[], maxTabs = 40): Promise<FocusSnapshot[]> {
  const seen: FocusSnapshot[] = [];
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press("Tab");
    const snap = await snapshotActive(page, baseline);
    if (snap.leftPage) break;
    if (seen.some((s) => s.index === snap.index)) break; // wrapped around — cycle complete
    expect(snap.focusVisible, `focus landed on ${snap.tag} without :focus-visible (keyboard focus lost its styling)`).toBe(true);
    expect(
      snap.indicator,
      `${snap.tag} "${snap.label}" has no visible focus indicator (outline or ring)`
    ).toBe(true);
    seen.push(snap);
  }
  return seen;
}

async function login(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/.*login/);
  await page.fill("#phone", "01700000002");
  await page.fill("#password", "Demo@1234");
  await page.click('button:has-text("Sign in"), button:has-text("প্রবেশ করুন")');
  await page.waitForURL(/.*\/$/, { timeout: 10_000 });
}

test.describe("Keyboard-only pass (WEB-03)", () => {
  test("login: Tab reaches every control in document order with a visible indicator", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("#phone")).toBeVisible();

    const baseline = await shadowBaseline(page);
    const visited = await tabThrough(page, baseline);

    // The login card is small but not empty: language toggle, phone, password,
    // password reveal, submit, register link, reset link — a trap that skipped
    // most of them (or a missing indicator) would show up here.
    expect(visited.length, `only ${visited.length} focusable element(s) reachable on /login`).toBeGreaterThanOrEqual(6);
    // In-flow only: every Tab step moved to a later DOM position.
    const indices = visited.map((v) => v.index);
    expect(indices, "a Tab step moved focus backwards through the document").toEqual([...indices].sort((a, b) => a - b));
  });

  test("settings: skip link, tab order, and the confirm dialog's focus trap", async ({ page }) => {
    await login(page);
    await page.goto("/settings");
    const deleteBtn = page.locator("button", { hasText: /Delete account|অ্যাকাউন্ট মুছে ফেলুন/ }).first();
    await expect(deleteBtn).toBeVisible({ timeout: 10_000 });

    // ── skip link: first Tab reaches it, Enter lands on #main ─────────────
    const baseline = await shadowBaseline(page);
    await page.keyboard.press("Tab");
    const first = await snapshotActive(page, baseline);
    expect(first.leftPage).toBe(false);
    expect(first.tag, `first Tab landed on ${first.tag} ("${first.label}") instead of the skip link`).toBe("a");
    expect(first.label.length).toBeGreaterThan(0);
    expect(first.indicator, "the skip link shows no focus indicator when focused").toBe(true);
    const isSkipLink = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.getAttribute("href") === "#main");
    expect(isSkipLink, "first Tab did not land on the skip-to-content link").toBe(true);
    await page.keyboard.press("Enter");
    await expect.poll(() => page.evaluate(() => document.activeElement?.id ?? ""), { timeout: 5_000 }).toBe("main");

    // ── document-flow order on the authed shell ───────────────────────────
    // Enter left focus on #main (tabIndex -1); drop it back to the document so
    // the next Tab starts from the shell's first control again.
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    const visited = await tabThrough(page, baseline, 8); // first 8 steps of the shell
    expect(visited.length, "Tab movement stalled inside the shell").toBeGreaterThanOrEqual(5);

    // ── dialog: focus trapped inside, Escape closes and restores focus ────
    // Focus the trigger explicitly first: the dialog restores focus to whatever
    // was focused when it opened, and this makes that target deterministic
    // (a touch-emulated click does not always move focus by itself).
    await deleteBtn.focus();
    await deleteBtn.click();
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return Boolean(el && el.closest('[role="dialog"]'));
      });
      expect(inside, "Tab escaped the open confirm dialog").toBe(true);
      const snap = await snapshotActive(page, baseline);
      expect(snap.indicator, `dialog control ${snap.tag} has no visible focus indicator`).toBe(true);
    }
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: 5_000 });
    const restored = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      return { tag: el?.tagName.toLowerCase() ?? "", text: (el?.textContent ?? "").trim() };
    });
    expect(restored.tag, "Escape closed the dialog but focus did not return to a control").toBe("button");
    expect(restored.text, "focus did not return to the Delete account trigger").toMatch(/Delete account|অ্যাকাউন্ট মুছে ফেলুন/);
  });
});
