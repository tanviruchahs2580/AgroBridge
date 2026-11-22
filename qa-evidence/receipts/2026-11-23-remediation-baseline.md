# Baseline — remediation wave 2 (master-prompt WPs), 2026-11-23

Machine: Windows 11 (10.0.26300), Git Bash, ambient **Node v24.19.0** — the project pins Node 22
(`.nvmrc`), which is unavailable on this machine (no nvm/fnm/volta). Every local result below is
**non-transferable**; CI (Node 22, both DB engines) is the transferable run. Tree: `main` at
`534bad7` (== `origin/main`), clean except untracked local `artifacts/`.

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | exit 0 |
| API suite | `npm run test --workspace apps/api` | **144 files, 795 passed, 1 skipped (796), 0 failed** (exit 0; 1134.8 s under disk pressure) |
| Web unit | `npm run test:unit --workspace apps/web` | **44 files, 330 passed, 0 failed** |
| Web lint | `npm run lint --workspace apps/web` | 0 errors, 0 warnings (budget 0) |
| Web build | `npm run build --workspace apps/web` | green; entry chunk 416.61 kB / gzip 132.90 kB |
| API eslint | `(cd apps/api && npx eslint src tests)` | 0 errors, **127 warnings** (budget 143 — within ratchet) |
| jscpd | `npm run qa:jscpd` | exit 0 (below 3 % threshold) |
| versioncode | `npm run qa:versioncode` | clean — 14003 monotonic |
| Lint budget | `node scripts/qa/lint-budget.mjs` | api 127/143, web 0/0 |
| Drift | `node scripts/drift-check.mjs` | exit 0 |
| TODO gate | `node scripts/todo-gate.mjs` | OK |
| Versions | `node scripts/check-versions.mjs` | 1.4.3 / versionCode 14003 consistent |
| Licence | `node scripts/licence-gate.mjs` | exit 0 |
| Links | `node scripts/qa/link-check.mjs` | clean (55 relative targets) |
| Claims | `node scripts/qa/claims-check.mjs` | clean |
| Route matrix | `node apps/api/scripts/route-matrix.mjs --check` | up to date (92 routes) |
| ERD | `node apps/api/scripts/gen-erd.mjs --check` | up to date (33 models) |
| knip | `npm run qa:knip` | **not determined — cannot run on this machine** (exit 1; oxc-parser requests a 2 GiB buffer with ~1 GB free). CI runs it. |

Deviations / environment notes:

- **Disk:** `C:` was 100 % full (314 MB free) at session start; ~1 GB was reclaimed from
  rebuildable caches (npm cache, pip, stale temp files, docker build cache, unused docker images —
  33 GB freed inside the Docker data VHDX, which cannot be compacted without `--allow-unsafe`, refused).
  The API suite ran under this pressure (19 min vs the usual ~7). Sibling-project containers stopped
  by the required `wsl --shutdown` were restarted to their prior state.
- `npm ci` was not re-run: `node_modules` is present and every gate above passed against it.
- PostgreSQL-profile tests (`test:pg`) not run at baseline — the local Postgres container is
  available; per-WP runs cover it where DB semantics change (none of this wave's WPs migrate schema).
