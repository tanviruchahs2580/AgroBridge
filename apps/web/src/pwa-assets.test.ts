/**
 * Shipped PWA/static assets vs the app's own launch colours.
 *
 * Two audit items that no other gate could see:
 *   - `manifest.webmanifest`'s `background_color` was near-white, contradicting
 *     the deliberate dark-green splash handover (`--color-splash-from`, which
 *     `#root:empty::before` paints before React commits, and which
 *     capacitor.config.ts matches for the Android launch screen). It
 *     reintroduced the blank first paint the boot frame exists to remove.
 *   - `index.html` carried `<link rel="maskable">`, which is not a link relation
 *     at all; maskability belongs to the icon's `purpose` in the manifest.
 *
 * This reads the real files, so the values cannot drift back silently.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.resolve(here, "..");

function read(rel: string): string {
  return readFileSync(path.join(WEB, rel), "utf8");
}

describe("PWA assets — the manifest matches the splash handover", () => {
  it("paints the first frame in --color-splash-from, not a near-white", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest")) as { background_color?: string; display?: string; lang?: string };
    const tokens = read("src/tokens.css");
    const splashFrom = tokens.match(/--color-splash-from:\s*(#[0-9a-fA-F]{6})/)?.[1]?.toLowerCase();

    expect(splashFrom, "tokens.css must define --color-splash-from").toBeTruthy();
    expect(manifest.background_color?.toLowerCase()).toBe(splashFrom);
    // The product is Bangla-first and installed standalone; both are load-bearing
    // for the native shells built from this manifest.
    expect(manifest.display).toBe("standalone");
    expect(manifest.lang).toBe("bn");
  });

  it("declares maskability in the manifest, not as a bogus link relation", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest")) as {
      icons?: { src: string; purpose?: string }[];
    };
    const maskable = (manifest.icons ?? []).filter((i) => (i.purpose ?? "").split(/\s+/).includes("maskable"));
    expect(maskable.length).toBeGreaterThan(0);

    // The retired link relation must not appear anywhere in index.html — the
    // file's own comment refers to it without spelling the attribute out, so
    // this assertion needs no HTML sanitisation at all (a strip-the-comments
    // pre-pass is what CodeQL's incomplete-multi-character-sanitization query
    // flagged, and it was also weaker than this: a strict whole-file assertion
    // cannot be defeated by an unclosed comment hiding live markup).
    const html = read("index.html");
    expect(html).not.toContain('rel="maskable"');
    // The manifest is still linked, and the maskable-capable icon is the one the
    // manifest points at.
    expect(html).toContain('rel="manifest"');
    expect(maskable.map((i) => i.src)).toContain("/icons/icon-maskable.png");
  });
});
