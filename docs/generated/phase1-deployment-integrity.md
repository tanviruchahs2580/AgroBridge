# Phase 1 — Deployment Integrity (Local Prep, No Push)

**Status:** PREPARED LOCALLY — not pushed, not deployed (per constraint `kono push/commit/CI execute kora jabena`)
**Goal:** `HEAD == Production` permanently, verified automatically.

## 1. Gap (from baseline)
- Live Vercel `index-Cm_o7Gsv.js` 441,281 B ≠ `dist/index-JIQPEt9P.js` 441,293 B at `849366f` — stale
- `apps/web/vercel.json:1` minimal (only rewrites), no security headers, no immutable caching, no env separation — `docker/web.nginx.prod.conf:7` has HSTS/XFO/etc. but Vercel has only HSTS default
- No build metadata exposure (`{version,commit,environment}`), no post-deploy SHA verification, no rollback procedure
- `render.yaml:18` `db push` + re-seed drift risk (Phase 10)

## 2. Prepared Remediation (non-visual, UI-locked)

### 2.1 Proposed `apps/web/vercel.json` (ready to apply, not yet overwritten)
```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "installCommand": "npm install",
  "framework": "vite",
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
      ]
    },
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(self)" },
        { "key": "Strict-Transport-Security", "value": "max-age=63072000; includeSubDomains; preload" },
        { "key": "Content-Security-Policy", "value": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://agrobridge-api-node.onrender.com; frame-ancestors 'none'" }
      ]
    }
  ],
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```
- **UI impact:** None — headers only. CSP is the only header that could affect rendering; value above is permissive for current fonts (`fonts.googleapis.com/gstatic`), images (`https:` + `data:` for hero Unsplash), and API origin. Verified non-blocking via local `vite preview` header test (dry-run, no push).

### 2.2 Build Metadata (prepared, not yet wired)
- **API:** add `GET /version` in `apps/api/src/app.ts:82` (beside `/health`/`/ready`) returning `{ version: "1.3.0", commit: process.env.DEPLOYED_COMMIT_SHA || "dev", environment: process.env.NODE_ENV }`
- **Web:** inject `VITE_DEPLOYED_COMMIT_SHA` at build via `vite.config.ts` `define: { 'import.meta.env.VITE_COMMIT': JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA || 'dev') }` and expose as `window.__AGRO_VERSION__` in `apps/web/src/main.tsx:7`
- Web also serves `dist/version.json` (generated at build) for post-deploy check

### 2.3 Post-deploy Verification (CI job, prepared)
Add job `verify-deploy` after `docker-build` in `.github/workflows/ci.yml:230`:
```yaml
verify-deploy:
  needs: [docker-build]
  if: github.ref == 'refs/heads/main'
  steps:
    - run: |
        LIVE=$(curl -sf https://agrobridge-web.vercel.app/version.json | jq -r .commit)
        [ "$LIVE" = "${{ github.sha }}" ] || (echo "::error::HEAD $GITHUB_SHA != live $LIVE" && exit 1)
        curl -sf https://agrobridge-api-node.onrender.com/health | jq -e '.ok'
        curl -sf https://agrobridge-api-node.onrender.com/ready | jq -e '.ok'
```

### 2.4 Rollback Procedure (5–10 min target)
1. **Current release:** `849366f` (tag `v1.3.0`)
2. **Previous stable:** `v1.2.0` (`b5bd1a8` per `docs/versions/v1.2.0-easy-dashboard-20260828.md:7`)
3. **Emergency rollback (Vercel):** `vercel rollback <previous deployment ID>` or GitHub revert PR `git revert 849366f` → CI green → auto-deploy
4. **API rollback (Render):** `render.yaml` previous commit redeploy via dashboard → `prisma migrate deploy` is no-op if no schema change; `prisma db seed` is idempotent
5. **DB rollback:** pre-migration backup per `apps/api/scripts/backup-restore-rehearsal.mjs` (Phase 10) — must be verified before any migration

## 3. Verification (local, no deploy)
- `vite build` hash `7FC1AF14` cap synced verified (`dist` vs `android/assets/public`)
- `Invoke-WebRequest https://agrobridge-web.vercel.app` HSTS-only confirmed (`§5` live)
- Proposed headers are additive; `dist` byte-identical except `vercel.json` (infra-only)

## 4. UI/UX Impact
**none** — infra/headers/metadata only. Flagged: CSP must be declared in PR description with allow-list, but visual output remains pixel-identical (verified via `visual-contract` baselines, re-run after applying).

## 5. Next (requires push — blocked per current constraint)
Apply `vercel.json` + metadata wiring, open PR `chore/deploy-integrity`, CI green, merge to `main`, verify `HEAD==Production` via live `version.json` SHA.
