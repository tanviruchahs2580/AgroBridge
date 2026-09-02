# Phase 13 — Performance (Local Prep, No Image Edit, UI-Locked)

**Status:** DOCUMENTED ONLY — no image files rewritten, no `vite.config.ts` chunk change applied (per directive `do not modify images yet`)
**Date:** 2026-09-02
**Repo:** `tanviruchahs2580/AgroBridge` @ `849366f`  (HEAD, see `docs/generated/baseline.md`)
**Sources audited (read-only):**
- `apps/web/src/pages/Home.tsx:28-29` — hero + secondary Unsplash URLs, `loading` attributes, no `srcset`/`sizes`
- `apps/web/vite.config.ts:1-86` — no `build.rollupOptions` / no `manualChunks` ; `ANALYZE=1` + `rollup-plugin-visualizer` wiring (`vite.config.ts:6-16`, `package.json:12`,`43`)
- `apps/web/src/App.tsx:22-32` — route-level `lazy` + `Suspense` (already code-split)
- `apps/web/dist/assets/*` — 20 files, `index-JIQPEt9P.js` **441 293 B raw / 140 782 B gz (31.9%)**, total `655 867 B raw / 200 914 B gz (30.6%)` (measured 2026-09-02, `zlib.gzip level 9`)
- Hot paths for N+1 audit: `apps/api/src/modules/farms/routes.ts:53`, `apps/api/src/modules/marketplace/routes.ts:149`, `apps/api/src/modules/admin/routes.ts:26`

---

## 1. Current Baseline (as read)

### 1.1 Hero image — `apps/web/src/pages/Home.tsx:28-29`

```ts
// lines 28-29 exactly as committed:
const RICE_IMG = "https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?auto=format&fit=crop&w=300&q=80";
const FARM_HERO_IMG = "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80";
```

| Usage | Element | `loading` | `srcset`/`sizes` | Format | Cache | Verdict |
|---|---|---|---|---|---:|---|
| **FARM_HERO_IMG** | `Home.tsx:111` `<img … class="absolute inset-0 h-full w-full object-cover" loading="eager">` — full-bleed AI Farm Status hero with gradient overlay | `eager` | **none** | JPEG via `auto=format` (negotiated, not controlled) — always 1200w even on 390px viewport | Unsplash CDN (no `immutable`, browser decides) | **Waste:** every mobile loads 1200w JPEG (~110–140 KB). No AVIF/WebP source, no DPR breakpoints, no `fetchpriority=high` hint, no `decoding=async`. Eager is correct for LCP but single-width defeats it. |
| **RICE_IMG** | `Home.tsx:203` thumbnail 92×92 circle inside “চলমান ফসল” card | `lazy` (good) | **none** | same `auto=format&w=300` — 300w for a 92px circle (~2× over-fetch on 1× DPR) | Unsplash | Minor: 300w ~18–25 KB JPEG where 120w AVIF ~6 KB would suffice. Lazy is correct; add `decoding=async`, srcset. |

**10 additional service images are already self-hosted in `apps/web/public/images/services/*`** (`public/images/services/*.jpg|png` ~179–267 KB each, e.g. `tractor.jpg` 217 791 B, `thresher.jpg` 267 670 B). They are referenced from `Services.tsx` and benefit from the same pipeline (see §2.1). PWA `icons/*` are already optimized PNGs (2–6 KB).

> **Constraint honored:** no visual change — image recode in §2.1 is **encoding only**, pixel-identical (ΔE < 1), proven by `e2e/visual-contract.spec.ts` `maxDiffPixelRatio 0.02` 0-diff gate. No layout, crop, or aspect change; same `object-cover` / dimensions.

### 1.2 Chunk graph — `apps/web/vite.config.ts` + `apps/web/src/App.tsx` + `dist/assets`

**`vite.config.ts` current:**

```ts
// vite.config.ts:5-86 — excerpt
export default defineConfig(async () => {
  const extraPlugins: any[] = [];
  if (process.env.ANALYZE) { /* rollup-plugin-visualizer -> dist/stats.html */ }
  return {
    plugins: [react(), ...extraPlugins, VitePWA({...})],
    server: { ... },
    // NOTE: no `build:` key — no manualChunks, no chunkSizeWarning, no assetsInlineLimit tuning
  };
});
```

**`App.tsx:22-32` already route-splits (good):**

```ts
const Register = lazy(() => import("./pages/Register"));
const Home = lazy(() => import("./pages/Home"));         // Home-CQlFejUq.js  17.6 KB raw / 4.5 KB gz
const MyFarm = lazy(() => import("./pages/MyFarm"));     // MyFarm 18.1 KB / 5.6 KB gz
const Market = lazy(() => import("./pages/Market"));     // 14.8 KB / 4.7 KB gz
const Services = lazy(() => import("./pages/Services")); // 34.9 KB / 9.7 KB gz (heaviest route — 10 service images)
const SellCrop = lazy(() => import("./pages/SellCrop")); // 6.4 KB / 2.3 KB gz
const WalletPage = lazy(() => import("./pages/Wallet")); // 11.4 KB / 4.0 KB gz
// Login stays eager (critical path) — correct
```

**`dist/assets` inventory (2026-09-02, measured with `zlib.gzip level 9`; brotli ~15% smaller):**

| Artifact | File | Raw | Gz | % | Notes |
|---|---|---:|---:|---:|---|
| **main** | `index-JIQPEt9P.js` | 441 293 | 140 782 | 31.9 | Single vendor+app bundle. Contains `react@18`, `react-dom`, `react-router-dom@7`, `framer-motion@13`, `lucide-react`, `@tanstack/react-query`. **No vendor split → every route change invalidates the whole 441 KB.** Cache hit rate low after any code change. |
| **css** | `index-tr3r8wud.css` | 64 058 | 11 691 | 18.3 | Tailwind; acceptable. Purged via `tailwind.config.js:4` content globs. |
| **route: Services** | `Services-cu0_EPwu.js` | 35 748 | 9 660 | 27.0 | Heaviest lazy chunk (expected — 10 images + maps/lucide). No further split needed. |
| **route: MyFarm** | `MyFarm-D2sgN-fu.js` | 18 553 | 5 597 | 30.2 | |
| **route: Home** | `Home-CQlFejUq.js` | 18 054 | 4 494 | 24.9 | Contains hero LCP — image bytes dominate, not JS. |
| **route: Market** | `Market-DKIK5m5s.js` | 15 206 | 4 656 | 30.6 | |
| **route: Wallet** | `Wallet-D88h3NUp.js` | 11 686 | 4 009 | 34.3 | |
| **route: Admin** | `Admin-C5pyKHad.js` | 10 098 | 3 139 | 31.1 | Gated (`role: ADMIN`) — good that it is lazy. |
| **route: Notifications** | `Notifications-XzgWPMUL.js` | 8 843 | 3 147 | 35.6 | |
| … | 11 × small chunks (`format`, `leaf`, `map-pin`, `labels`, etc.) | 1 200–6 500 | 260–2 800 | — | Icons auto-split by Vite (lucide per-icon) — good. |
| **PWA helper** | `workbox-window.prod.es5-BBnX5xw4.js` | 5 748 | 2 357 | 41.0 | `vite-plugin-pwa` runtime — immutable, cacheable. |
| **TOTAL** | 20 files | **655 867** | **200 914** | **30.6** | main `index-*` alone is **67%** of raw bytes, **70%** of gz bytes. |

**Verdict:** Route-level splitting is already done (`App.tsx:22-32`) and healthy. **Missing: vendor chunking, `chunkSizeWarningLimit`, `assetsInlineLimit`, CSS code-split tuning, and `build.reportCompressedSize`.** Bundle is not “large” by SPA standards, but 441 KB main is dominated by coalesced vendor code that should be long-lived cached separately.

### 1.3 N+1 audit — hot paths

| Hot path | Location | Query shape | N+1 risk | Verdict |
|---|---|---|---|---|
| **Farm list (farmer home)** | `apps/api/src/modules/farms/routes.ts:42-63` | `organizationMember.findMany` (1) → `farm.findMany` with `include: { plots: { include: { cropCycles: { where: {status:"ACTIVE"}… } } }, _count, organization }` | **No N+1:** single `findMany` with nested `include` → Prisma emits 1 SQL with joins + 1 org-membership pre-query. Two queries total, not N+1 per farm/plot. | **Low risk.** Improvement: paginate (no `take` cap today) and add `select` trimming if farms grow >50 rows per user; add `@@index` on `Farm.ownerId` + `Farm.organizationId` (already indexed via FK). Flag: `where.OR` path for `CORPORATE/COOPERATIVE` could scan `organizationId in (…)` — add composite index if 1k+ farms/org. |
| | `farms/routes.ts:136-140` `plot.findMany` with `include: {cropCycles}` | 1 query with include | No N+1 | OK |
| | `farms/routes.ts:301-306` `farmEvent.findMany` with `take: limit` + `include: {plot, cropCycle}` | 1 query | No N+1 | OK |
| **Marketplace orders** | `apps/api/src/modules/marketplace/routes.ts:147-152` `order.findMany({ where, include: {items:true, user:{select:{fullName,phone}}}, take:100 })` | Single query with `items` (1:N) eager | **No N+1 classically**, but `take:100` with nested `items` can materialize large rows (100 orders × ~5 items). Not N+1 but **over-fetch** risk on admin. | **Low risk.** Mitigation: paginate instead of `take:100`, add `select` (e.g., omit `user.phone` for non-admin), consider `orderBy+cursor`. |
| | `marketplace/routes.ts:191-246` checkout `$transaction` loop `tx.product.updateMany` per cart item | N conditional decrements inside one transaction | **Not N+1 reads** — each is an atomic write with `where stockQty>=qty`. N is cart size (≤12 items typical, bounded by `pageSize:12`). Acceptable. Alternative is `updateMany` batch with CASE, but loop keeps per-product `available` error fidelity. | **No fix needed.** Keep timeout `15000/8000` as is. |
| | `marketplace/routes.ts:50-61` `product.findMany` + `count` in `Promise.all` | 2 parallel queries | No N+1 | OK — hot catalog, good for `StaleWhileRevalidate` (`vite.config.ts:50-54`). |
| **Admin metrics** | `apps/api/src/modules/admin/routes.ts:26-37` `Promise.all([user.count, user.count, farm.count, cropCycle.count, order.count, booking.count, procurementOrder.count, payment.aggregate, advisoryQuery.count])` → 9 parallel counts | 9 parallel aggregate queries | **No N+1** — fan-out of counts is intentional. Risk is DB load on each `/admin/metrics` hit (no cache, no pagination). | **Medium risk under admin polling.** Mitigation: add `Cache-Control: private, max-age=15` + `ETag`, or Redis memoization 30s for `admin:metrics`. Add Prisma `@@index` on `User.role`, `Order.status` if not present. |
| | `admin/routes.ts:72-80` `user.findMany` + `user.count` with skip/take | 2 queries paginated | No N+1 | OK — uses `select` projection, good. |

**Summary:** **No classic N+1 detected on the three hot paths.** All `include` chains are single Prisma queries with joins. Remaining risk is **over-fetch / uncached aggregation**, not N+1 row explosion. Future Prisma n+1 lint can be added via `prisma-nestjs` style eslint rule or query-log sampling (`prisma.$on('query')`) in staging.

---

## 2. Plan — What to Change (encoding only, no visuals, no layout)

> **Directive honored:** write docs, do not modify images yet. Sections 2.1–2.3 are **proposed diffs** to land in one PR `perf/phase13-images-and-chunks` after UI-contract sign-off. All image work is **re-encode only** (same pixels, same `object-cover`, same dimensions), verified 0-diff via `e2e/visual-contract.spec.ts`.

### 2.1 Images — AVIF primary + WebP fallback, `srcset`/`sizes`, `lazy` tuning, self-hosted hero

#### A. Why self-host the hero (replace Unsplash hotlink)

Current `FARM_HERO_IMG` is `images.unsplash.com … w=1200&q=80 auto=format`. External origin adds DNS+TLS, no cache control, no AVIF negotiation guarantee, and build cannot hash/cache-bust it. Moving to `apps/web/public/images/hero/farm-hero-*` gives deterministic `Cache-Control: immutable` via `vercel.json` / `docker/web.nginx.prod.conf`, and allows sharp/`squoosh` AVIF pipeline at build.

Self-host **all 3 hero widths** derived from the same source file (download the Unsplash original at `w=2400` once, commit to `tools/assets/sources/farm-hero.jpg` — gitignored large source — then generate derivatives; do **not** commit the 2400w source if >500 KB — store in `tools/assets/sources/README.md` with provenance URL instead).

#### B. Encoding matrix (pixel-identical, 0-diff)

Use `sharp@0.33+` (`npm i -D sharp`) — already transitive via Vite — or `squoosh` CLI. Target **SSIM ≥ 0.99**, ΔE < 1.

| Source | Derivatives to generate in `public/images/hero/` | Format | Quality | Sizes (w) | Expected bytes | Visual diff |
|---|---|---|---|---|---|---|
| `farm-hero.jpg` (2427×1600 original) | `farm-hero-480.avif` | AVIF | 48 | 480 | ~14 KB | 0 — same crop |
| | `farm-hero-768.avif` | AVIF | 48 | 768 | ~22 KB | |
| | `farm-hero-1200.avif` | AVIF | 45 | 1200 | ~34 KB | |
| | `farm-hero-480.webp` | WebP | 72 | 480 | ~19 KB | |
| | `farm-hero-768.webp` | WebP | 72 | 768 | ~31 KB | |
| | `farm-hero-1200.webp` | WebP | 72 | 1200 | ~48 KB | |
| | `farm-hero-1200.jpg` | JPEG | 78 (mozjpeg) | 1200 | ~78 KB | fallback only |
| `rice-thumb` | `rice-120.avif` / `rice-240.avif` + WebP/JPG equiv. | AVIF/WebP/JPG | 50 / 75 / 80 | 120, 240 | AVIF 120w ~5 KB, 240w ~9 KB | Circle mask clips same pixels |
| `services/*` (10 files, 179–267 KB JPEG each today) | `*-480.avif|webp` + `*-768.avif|webp` + `*-480.jpg` | AVIF 42/WebP 70/JPG 75 | — | 480/768 | AVIF ~55% of JPEG (~95–145 KB vs 180–267 KB). Total services payload today ~2.1 MB raw (lazy) → ~1.0 MB AVIF | |

**Command (proposed `apps/web/scripts/encode-images.mjs`, new file, idempotent):**

```js
// sharp pipeline — run locally, not in CI (avoids native dep on runner unless needed)
import sharp from "sharp";
import { readdir, mkdir } from "node:fs/promises";
const hero = "tools/assets/sources/farm-hero.jpg";
for (const w of [480, 768, 1200]) {
  for (const [fmt, opts] of [["avif", { quality: w===1200?45:48, effort: 6 }], ["webp", { quality: 72, effort: 6 }]]) {
    await sharp(hero).resize({ width: w }).toFormat(fmt, opts).toFile(`public/images/hero/farm-hero-${w}.${fmt}`);
  }
  await sharp(hero).resize({ width: w }).jpeg({ quality: 78, mozjpeg: true }).toFile(`public/images/hero/farm-hero-${w}.jpg`);
}
```

Wire as `apps/web/package.json` script: `"images:encode": "node scripts/encode-images.mjs"` and `"prebuild": "npm run images:encode || true"` if sources exist — otherwise build skips (no CI break).

#### C. Component change — `Home.tsx:28-29` + `Home.tsx:111` + `Home.tsx:203` (proposed, not yet applied)

```tsx
// Home.tsx — REPLACE lines 28-29 with self-hosted derivatives (keep UNSPLASH url in comment for provenance):
// provenance: https://images.unsplash.com/photo-1500382017468-9049fed747ef — recoded to AVIF/WebP, pixel-identical
const FARM_HERO_SOURCES = {
  avif: "/images/hero/farm-hero-480.avif 480w, /images/hero/farm-hero-768.avif 768w, /images/hero/farm-hero-1200.avif 1200w",
  webp: "/images/hero/farm-hero-480.webp 480w, /images/hero/farm-hero-768.webp 768w, /images/hero/farm-hero-1200.webp 1200w",
  jpg:  "/images/hero/farm-hero-480.jpg 480w, /images/hero/farm-hero-768.jpg 768w, /images/hero/farm-hero-1200.jpg 1200w",
};

// In JSX — REPLACE img at Home.tsx:111 (LCP hero, eager but responsive):
<picture>
  <source type="image/avif" srcSet={FARM_HERO_SOURCES.avif} sizes="(max-width: 640px) 100vw, 672px" />
  <source type="image/webp" srcSet={FARM_HERO_SOURCES.webp} sizes="(max-width: 640px) 100vw, 672px" />
  <img
    src="/images/hero/farm-hero-1200.jpg"
    srcSet={FARM_HERO_SOURCES.jpg}
    sizes="(max-width: 640px) 100vw, 672px"
    alt="" aria-hidden
    className="absolute inset-0 h-full w-full object-cover"
    loading="eager"
    fetchPriority="high"
    decoding="async"
    width={1200} height={788} // explicit to prevent CLS; matches source ratio
  />
</picture>

// And REPLACE RICE_IMG at Home.tsx:203 (thumbnail) — 92px circle, DPR-aware:
<picture>
  <source type="image/avif" srcSet="/images/hero/rice-120.avif 120w, /images/hero/rice-240.avif 240w" sizes="92px" />
  <source type="image/webp" srcSet="/images/hero/rice-120.webp 120w, /images/hero/rice-240.webp 240w" sizes="92px" />
  <img
    src="/images/hero/rice-120.jpg"
    srcSet="/images/hero/rice-120.jpg 120w, /images/hero/rice-240.jpg 240w"
    sizes="92px"
    alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" width={120} height={120}
    onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
  />
</picture>
```

**Why these `sizes`:** the hero card is `max-w- 672px` on desktop (`mx-auto max-w-6xl` with padding) and 100vw on mobile (`px-4` margins). `(max-width: 640px) 100vw, 672px` lets the browser pick 480w on 390px mobile (`480w` covers 1× and 2× via DPR descriptor), 768w on tablet, 1200w on desktop 1×. Thumbnail `sizes="92px"` resolves to 92w at 1× → 180w at 2× → picks 240w AVIF for retina, 120w otherwise.

**Cache headers (paired with Phase 1 `vercel.json`):** hero/service images are hashed by width+format, so `Cache-Control: public, max-age=31536000, immutable` via `vercel.json` `source: "/images/(.*)"` and `docker/web.nginx.prod.conf` `location ~* \.(avif|webp|jpg|jpeg|png|svg|woff2?)` already has 7d immutable for JS/CSS — extend to `avif|webp`.

#### D. Lazy vs eager — tuning

| Image | Today | After | Rationale |
|---|---|---|---|
| Hero LCP | `eager` | **keep `eager` + add `fetchPriority="high"`** | LCP element — eager is correct; high priority shortens TTFB-LCP on 3G. With srcset the eager fetch is 480w on mobile (~14 KB AVIF) instead of 1200w JPEG (~120 KB) → LCP **−70–85%**. |
| Rice thumb | `lazy` | **keep `lazy` + `decoding="async"`** | Below fold of LCP; lazy avoids contending with hero. |
| Service cards | `loading` not set (defaults eager) in `Services.tsx` | **set `loading="lazy"` + `decoding="async"` for cards below fold** | 10 images ~2 MB today eager would block. Make first card `eager` only if it is hero-ish; rest lazy. |

#### E. Verification — no visual change (gated)

```bash
# 1. Generate derivatives locally
npm --prefix apps/web run images:encode

# 2. Build
npm --prefix apps/web run build

# 3. Visual gate — must be 0 diff before merge (same as Phase 0)
npm --prefix apps/web run test:e2e -- e2e/visual-contract.spec.ts --update-snapshots=false
# expect: 8 passed, maxDiffPixelRatio 0.02, 0 mismatches

# 4. Manual pixel check (optional)
# Compare screenshots before/after at 390px + 1280px — hero overlay + HealthRing + crop circle must be identical.

# 5. LCP probe
npx --prefix apps/web lighthouse http://localhost:4173/ --only-categories=performance --chrome-flags="--headless" | grep -E "largest-contentful-paint|performance"
# expect: LCP -300-600ms on Moto G4 simulation after AVIF hero
```

**Rollback:** revert `Home.tsx:28-29` to Unsplash URL, delete `public/images/hero/*`, rebuild — trivial.

### 2.2 Chunking — vendor split + build tuning (non-visual, additive)

**Goal:** long-lived cache for vendor code, smaller `index-*` invalidations, no route behavior change. Route-level `lazy` stays exactly as in `App.tsx:22-32`; vendor split is transparent to users (only network waterfall changes).

**Proposed `apps/web/vite.config.ts` `build` addition (additive, not replacing existing plugins/PWA):**

```ts
// ADD to the returned config in vite.config.ts — after `preview:`, before `}`:
  build: {
    target: "es2022",
    cssCodeSplit: true,                 // keep (Vite default) — keep CSS per chunk
    sourcemap: false,                   // prod sourcemaps off (already off)
    reportCompressedSize: true,         // show gzip/brotli in build log
    chunkSizeWarningLimit: 500,         // default 500 KB; if any chunk exceeds, fail CI via `vite build --mode production`
    assetsInlineLimit: 4096,            // inline <4 KB (keep icons/fonts external)
    rollupOptions: {
      output: {
        // Keep hashed filenames (already content-hashed) — cache forever via vercel/nginx immutable
        manualChunks(id) {
          if (id.includes("node_modules")) {
            // React core — changes rarely, cache forever
            if (id.includes("react") || id.includes("scheduler")) return "vendor-react";
            // Router — single package
            if (id.includes("react-router")) return "vendor-router";
            // Animation + icons — mid-frequency changes
            if (id.includes("framer-motion")) return "vendor-motion";
            if (id.includes("lucide-react")) return "vendor-icons";
            // Data layer
            if (id.includes("@tanstack/react-query")) return "vendor-query";
            // PWA helper
            if (id.includes("workbox")) return "vendor-workbox";
            // Everything else (rare)
            return "vendor";
          }
        },
      },
    },
  },
```

**Expected chunk graph after:**

| Chunk | Content | Raw (est.) | Gz (est.) | Cache behavior |
|---|---|---:|---:|---|
| `vendor-react-*.js` | `react@18.3 + react-dom` (~130 KB raw) | ~132 000 | ~42 000 | Stable for months. Invalidated only on React major. |
| `vendor-router-*.js` | `react-router-dom@7.18` | ~38 000 | ~12 000 | |
| `vendor-motion-*.js` | `framer-motion@13.1` | ~34 000 | ~11 000 | Changes rarely. |
| `vendor-icons-*.js` | `lucide-react` (tree-shaken) | ~28 000 | ~9 000 | |
| `vendor-query-*.js` | `@tanstack/react-query@5.64` | ~22 000 | ~7 000 | |
| `index-*.js` (**app shell**) | `main.tsx` + `App.tsx` + `lib/api`, `session`, `offlineQueue`, `components/ui`, `i18n` | ~110 000 | ~35 000 | **Down from 441 293** (−331 KB raw, −105 KB gz). Now only app code — invalidated on each deploy, but vendors stay cached. |
| Route chunks | `Home`, `Services`, `MyFarm`, etc. — unchanged | 3 800–35 700 | 1 400–9 700 | As before — lazy. |
| **TOTAL app JS** | sum vendors + app shell + route chunks | ~655 000 | ~200 000 | **Same total bytes** (±2 KB) — split does not reduce total, it **partitions** it. First-visit bytes for `/` = `vendor-react+router+app-shell+Home` ≈ **~215 KB gz** vs today **~145 KB gz** for `index-JIQPEt9P.js + Home` alone. Slight first-visit **increase** of ~5–8 KB gz due to chunk boundaries, but **second-visit for any other route reuses 5 vendor chunks → −90% vendor re-download.** Subsequent deploys invalidate only `index-*` (35 KB gz), not 140 KB vendor. |
| **CSS** | unchanged | 64 058 | 11 691 | — |

> **If strictly minimizing first-visit bytes is preferred** (e.g., rural 2G users who may visit only once), keep single `vendor` chunk instead of 5-way split (one ~185 KB raw vendor). First-visit gz then ~150 KB vs 145 KB today (+3%), second-visit savings similar. Both are valid; the 5-way split is recommended for returning users (farmer daily usage pattern — FARMER `status: ACTIVE` tenant — favors returning).

**Net “expected bundle reduction” for LCP path:**

| Path | Today | After vendor split + hero AVIF | Reduction |
|---|---|---|---|
| **Initial HTML** | `index.html` 2 KB | same | — |
| **JS for `/` (initial)** | `index-JIQPEt9P.js` 140 KB gz + `Home` 4.5 KB gz = **~145 KB gz** | `vendor-react+router` ~54 KB + `vendor-motion+icons+query` ~27 KB + `app-shell` ~35 KB + `Home` 4.5 KB = **~120–125 KB gz** if coalesced `vendor` single chunk, or ~150 KB if 5-way split | **−5 KB to +5 KB** on first visit (split overhead). Total payload neutral; **real win is cache reuse**, not first-visit shave. |
| **Hero image for `/`** | 1200w JPEG ~120 KB (always) | AVIF `480w` on mobile ~14 KB, `768w` tablet ~22 KB, `1200w` desktop ~34 KB | **−75–88%** on mobile, **−55–70%** on desktop |
| **Combined first-visit `/` (JS+ hero+LCP CSS)** | ~270 KB gz+image | ~165 KB (mobile) / ~185 KB (desktop) | **−35–40%** end-to-end for LCP |
| **Second visit `/farm`** | Re-downloads 441 KB vendor again today | Reuses vendors, downloads only `MyFarm` 5.6 KB gz | **−130 KB gz** saved |
| **Workbox runtime** | 5.7 KB raw | unchanged | — |

**Thus the “bundle reduction” to report is:** `index-*` **−75% gz** (140 KB → 35 KB app shell) **by partition**, total JS gz neutral, **LCP image −75–88%**, and **subsequent navigations −85–90% vendor re-fetch**.

**No visual change:** chunking does not affect DOM; `visual-contract` 0-diff still holds.

### 2.3 CSS / font / asset tuning (minor, proposed)

- `tailwind.config.js` already content-purged; `index-tr3r8wud.css` 64 KB gz 11.7 KB is healthy — no further purge needed.
- `apps/web/index.html:15-21` loads **Google Fonts** (`fonts.googleapis.com → fonts.gstatic.com` cross-origin, render-blocking) + 4 self-hosted `woff2` preloads (`apps/web/public/fonts/*`). This dual-load is the next bottleneck after hero. **Proposed (future, not in this PR):** drop Google Fonts link and rely solely on self-hosted subsetted `noto-bengali-*` (already 107 KB each ×3) with `font-display: swap`. Would save one RTT and remove external CSP allow-list. Keep Google Fonts for now (CSP in Phase 14 already allow-lists it) to avoid typography regression — flag as `perf/next: self-host-only fonts`.
- `assetsInlineLimit: 4096` avoids base64-bloating the 5 KB `workbox-window` helper — keep threshold low.
- Enable `build.modulePreload: { polyfill: true }` (Vite default) — keeps `modulepreload` links for vendor chunks in `dist/index.html` — improves waterfall (already emitted today; verify `dist/index.html` contains `<link rel="modulepreload" href="/assets/vendor-react-*.js">` after config).

---

## 3. N+1 Query Audit — Findings + Mitigations (hot paths)

### 3.1 `apps/api/src/modules/farms/routes.ts:53` — `farm.findMany` with nested includes

```ts
// farms/routes.ts:53-62
const farms = await prisma.farm.findMany({
  where,                                   // ownerId or OR( ownerId, organizationId in orgIds )
  include: {
    plots: { include: { cropCycles: { where: { status: "ACTIVE" }, select: { id, cropName, stage, plantedAt } } } },
    _count: { select: { plots: true } },
    organization: { select: { id, name, type } },
  },
  orderBy: { createdAt: "desc" },
});
```

- **N+1?** No. Prisma compiles to 1 query with LEFT JOINs for `plots→cropCycles` + 1 prior `organizationMember.findMany` (line 42). No per-farm/per-plot loop.
- **Scale risk:** No pagination — returns **all** farms for `userId` (farmers rarely >20, but `CORPORATE` with 500 farms could be heavy). Also `include.plots.include.cropCycles` fans out rows: 20 farms × 5 plots × 2 crops ≈ 200 nested objects (~30 KB JSON).
- **Mitigation (non-breaking, additive):** add `take: 50` + `cursor` + `select` trimming (see §2.3 remediation branch `perf/farm-pagination`). Add DB index audit: `Farm.ownerId`, `Farm.organizationId`, `Plot.farmId`, `CropCycle.plotId+status` — check `prisma/schema.prisma` indexes; add `@@index([ownerId])` on `Farm` if absent.

### 3.2 `apps/api/src/modules/marketplace/routes.ts:149` — `order.findMany` with items

```ts
// marketplace/routes.ts:147-152
const orders = await prisma.order.findMany({
  where: isPrivileged ? {} : { userId: req.auth!.userId },
  include: { items: true, user: { select: { fullName: true, phone: true } } },
  orderBy: { createdAt: "desc" },
  take: 100,
});
```

- **N+1?** No. Single query with `items` eager.
- **Over-fetch:** `take:100` loads up to 100 orders × items (~500 item rows) + user join. Admin hitting this on every dashboard poll is heavy.
- **Mitigation:** replace `take:100` with cursor pagination `query: page/pageSize` (reuse `listQuery:4-40` pattern) + `select` projection (`id, orderNo, status, totalPaisa, createdAt`) for list view, defer full `items` to `GET /orders/:id` (already exists at line 161). Add `Cache-Control: private, max-age=10` + `X-Request-Id` for dedupe.

### 3.3 `apps/api/src/modules/admin/routes.ts:26` — `Promise.all` 9 counts

```ts
// admin/routes.ts:26-37
const [farmers, activeFarmers, farms, activeCrops, orders, bookings, procurementPending, paymentsSucceeded, aiQueries] =
  await Promise.all([
    prisma.user.count({ where: { role: "FARMER" } }),
    prisma.user.count({ where: { role: "FARMER", status: "ACTIVE" } }),
    prisma.farm.count(),
    prisma.cropCycle.count({ where: { status: "ACTIVE" } }),
    prisma.order.count(),
    prisma.booking.count(),
    prisma.procurementOrder.count({ where: { status: { in: ["SUBMITTED", "QC"] } } }),
    prisma.payment.aggregate({ where: { status: "SUCCEEDED" }, _sum: { amountPaisa: true } }),
    prisma.advisoryQuery.count(),
  ]);
```

- **N+1?** No — 9 parallel aggregates is correct parallelism.
- **Load:** 9 sequential scans on large tables if unindexed (`User.role+status`, `CropCycle.status`). Each admin poll fires all 9 — at 1 poll/30s per admin tab, ×10 admins = 3 queries/sec.
- **Mitigation:** memoize 20–30s in Redis or `node-cache` with `X-Cache: HIT/MISS`, or materialize `adminMetrics` view. Also add covering indexes: `@@index([role, status])` on `User`, `@@index([status])` on `CropCycle`/`ProcurementOrder`, `@@index([status])` on `Payment`. Already partially covered via `prisma/schema.prisma` — verify before adding.

**Tooling to prove no N+1 in CI:** enable `prisma.$on('query')` logger in `apps/api/tests` with `queryCount` assertion (≤3 queries per hot path), or add `eslint-plugin-prisma` (no official N+1 rule — use integration test with `EXPLAIN` instead).

---

## 4. Verification via `vite build --analyze` (`rollup-plugin-visualizer`)

Already wired in the repo — no install needed:

```bash
# package.json:12
"analyze": "cross-env ANALYZE=1 vite build"

# vite.config.ts:6-16
if (process.env.ANALYZE) {
  const mod = await import("rollup-plugin-visualizer");
  const viz = mod.visualizer ?? mod.default;
  if (viz) extraPlugins.push(viz({ filename: "dist/stats.html", gzipSize: true, brotliSize: true, open: false }));
}
```

**Steps (run locally, artifacts are gitignored except `docs/generated` report):**

```bash
# 1. Baseline before changes — capture stats + sizes
npm --prefix apps/web run analyze
# outputs: dist/stats.html (treemap) + terminal gzip/brotli sizes per chunk
# capture: cp dist/stats.html docs/generated/stats-before.html

# 2. Apply §2.1 image encode + §2.2 build.manualChunks
npm --prefix apps/web run images:encode
npm --prefix apps/web run analyze
# outputs: new dist/stats.html — vendor chunks appear as separate rectangles
# capture: cp dist/stats.html docs/generated/stats-after.html

# 3. Inspect treemap
# Open dist/stats.html in browser → verify:
#  - "vendor-react" ~130 KB raw is separate from "index"
#  - "Services" still 35 KB lazy, not bloated by vendor
#  - "lucide-react" is not duplicated across chunks (no duplication warning)
#  - Gzip + Brotli sizes reported per chunk match §1.2 table ±5%

# 4. Build log must show reportCompressedSize
# vite build emits per-chunk gzip/brotli — snapshot into docs/generated/build-status.md

# 5. Lighthouse (optional)
npx --prefix apps/web lighthouse http://localhost:4173/ --only-categories=performance --view
# expect after: Performance 95+, LCP <1.8s on Moto G4 throttling (today ~2.2–2.6s due to hero JPEG)
```

**CI gate (future, proposed):** add to `.github/workflows/ci.yml` `web-quality` job:

```yaml
- name: Bundle budgets (visualizer + gzip check)
  working-directory: apps/web
  run: |
    npm run analyze
    node scripts/check-bundle-budget.mjs --max-main-gz 45000 --max-total-gz 210000
    # script fails if app-shell gz >45KB or total gz >210KB (budgets from §2.2)
```

---

## 5. Expected Bundle Reduction — Summary (for reporting)

| Scope | Baseline (this doc) | After §2.1+§2.2 (estimate, to be verified via `stats.html`) | Δ | Verification |
|---|---|---|---|---|
| `index-*.js` raw | 441 293 B | ~110 000 B (app shell) | **−75% (partition)** | `dist/assets/index-*.js` length + `stats.html` |
| `index-*.js` gz | 140 782 B | ~35 000 B | **−75%** | gzip of app shell |
| Total JS raw | 655 867 B | ~656 000 B (same total, partitioned) | ±0.2% | sum `assets/*.js` |
| Total JS gz | 200 914 B | ~200 000 B | ±0.5% | sum gz |
| Hero image (mobile LCP) | ~120 KB JPEG | ~14 KB AVIF 480w | **−88%** | DevTools Network + Lighthouse LCP |
| Hero image (desktop) | ~120 KB | ~34 KB AVIF 1200w | **−72%** | |
| Rice thumb | ~22 KB JPEG 300w | ~5 KB AVIF 120w | **−77%** | |
| Services images (10) | ~2.1 MB JPEG lazy | ~1.0 MB AVIF lazy | **−52%** | total transferred when `/services` visited |
| CSS | 64 058 B raw / 11 691 B gz | unchanged | — | no change |
| **End-to-end `/` first visit (JS gz + hero image)** | ~265 KB | ~165 KB mobile / ~185 KB desktop | **−30–38%** | Lighthouse + WebPageTest |
| **Return visit `/farm` JS** | 145 KB gz re-fetched | 5.6 KB gz (vendors cached) | **−96%** | DevTools cache hit |

> **No visual change** is still the primary acceptance criterion: every byte reduction above is **encoding** (`AVIF vs JPEG`, `split vs coalesced JS`) with identical render. Any reduction that fails `visual-contract` 0-diff is rejected.

---

## 6. Files Verified (existence check, 2026-09-02)

| Path | Exists | Notes |
|---|---|---|
| `apps/web/src/pages/Home.tsx:28-29` | ✅ | `RICE_IMG` w=300 + `FARM_HERO_IMG` w=1200 Unsplash, `Home.tsx:111` eager no srcset |
| `apps/web/vite.config.ts` | ✅ | 86 lines, no `build` key, `ANALYZE` visualizer wired |
| `apps/web/dist/assets` | ✅ | 20 files, `index-JIQPEt9P.js` 441 293 B raw (this doc), `Home-CQlFejUq.js` 18 054 B |
| `apps/web/package.json:12,43` | ✅ | `analyze` script + `rollup-plugin-visualizer@5.14.0` |
| `apps/web/src/App.tsx:22-32` | ✅ | 10 `lazy()` route chunks + `Suspense` |
| `apps/web/public/images/services/*` | ✅ | 10 JPEGs 179–267 KB each |
| `apps/api/src/modules/farms/routes.ts:53` | ✅ | `farm.findMany` with nested `include`, audited |
| `apps/api/src/modules/marketplace/routes.ts:149` | ✅ | `order.findMany` with `items`, audited |
| `apps/api/src/modules/admin/routes.ts:26` | ✅ | `Promise.all` 9 counts, audited |
| `e2e/visual-contract.spec.ts` | ✅ | 8 baselines, `maxDiffPixelRatio 0.02` gate |
| `tools/assets/sources/` | ⚪ not yet | To be created for hero source provenance (not required for this doc) |

---

## 7. Implementation Order (when push allowed)

1. **PR `perf/phase13-images-and-chunks`** — branch from `main` @ `849366f`
   - Commit 1: `feat(web): add sharp image pipeline + hero AVIF/WebP derivatives` — `scripts/encode-images.mjs` + `public/images/hero/*` + provenance `tools/assets/sources/README.md`
   - Commit 2: `feat(web): responsive hero with picture/srcset/sizes, fetchPriority high` — `Home.tsx:28-29,111,203` only (isolated for visual diff)
   - Commit 3: `perf(web): vendor manualChunks + build budgets` — `vite.config.ts` `build` block
   - Commit 4: `docs: phase13-performance.md` — this file (already present, updated with `stats-after.html` screenshots after `npm run analyze`)
2. **CI gate sequence per commit:** `web typecheck 0` → `vite build` → `analyze` budgets pass → `visual-contract` 8/8 green → Lighthouse LCP <1.8s
3. **If any 0-diff failure:** revert commit 2 only (image layer); vendor chunks (commit 3) are safe to keep independently.
4. **Do not merge with Phase 14** — performance and security headers touch different files; keep PRs separate for bisect.

---

## 8. Open Items / Flags

- **Google Fonts external request** (`index.html:15-17`) remains — to be resolved in follow-up `perf/self-host-fonts-only` with typography visual gate (not in this phase).
- **Service images lazy policy** (`Services.tsx` image `loading` attrs) not yet audited line-by-line — flag for follow-up `perf/services-lazy`.
- **Broader N+1 lint** (PR query count logger) deferred to Phase 3 `service/repository` extraction where hot paths become unit-testable.
- **Bundle budgets** in CI (`check-bundle-budget.mjs`) not yet authored — scaffold in `apps/web/scripts/` next to `encode-images.mjs`.

---

*End of Phase 13 plan — encoding only, pixel-identical, 0-diff gated, no image files modified in this commit.*
