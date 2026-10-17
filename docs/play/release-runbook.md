# AgroBridge — Play Store release runbook

The end-to-end procedure from "domain in hand" to "live on Google Play". Written so the
release can be repeated by anyone, and so a failure at any step has a named cause.

**Two things only the owner can do, and nothing else is pending:**
1. Point a domain at the web app + API and set the environment variables in step 4.
2. Create the upload keystore (step 5) and the Google Play app record (step 7).

Everything else — the code, the signing wiring, the store artwork, the listing copy, the
data-safety answers, the reviewer account tooling — is in this repository.

---

## 0. Preflight (5 minutes)

```bash
git pull
npm ci --include=dev
npm run typecheck                      # api + web
npm run test --workspace apps/api      # 148 tests (1 PG-gated skip by design)
npm run test:unit --workspace apps/web # 108 tests
npm run lint --workspace apps/web
npm run build --workspace apps/web
```

All five must pass. Anything red here will also be red in CI.

---

## 1. Decide the two hostnames

| What | Example | Notes |
|---|---|---|
| Web app (SPA) | `https://agrobridge.com` | Serves the PWA **and** the legal pages Play requires |
| API | `https://api.agrobridge.com` | Must be HTTPS; the Android release build refuses cleartext |

The Android app is a bundled WebView: it ships the web bundle inside the APK and talks only
to the API. So changing the web domain does **not** require a new APK — but changing the API
domain does, because the API base URL is compiled into the bundle.

---

## 2. Deploy the web app

Vercel (already configured via `vercel.json` + `scripts/vercel-build-web.mjs`):

```bash
vercel --prod        # from the repo root
```

Then add the custom domain in the Vercel dashboard and set, for the **web** project:

| Variable | Value |
|---|---|
| `VITE_API_BASE_URL` | `https://api.agrobridge.com/api/v1` |

`apps/web/.env.production` holds the fallback used by local/CI builds — update it in the same
commit so a locally built APK points at the same API.

## 3. Deploy the API

From the repo root (the API project's Root Directory must be empty in Vercel; deploying from
a subfolder double-joins paths):

```bash
vercel --prod        # or let the GitHub integration deploy on push
```

Required production variables:

| Variable | Value / why |
|---|---|
| `DATABASE_URL` | Postgres connection string (Neon) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | 64-char random strings. Startup aborts on defaults. |
| `NODE_ENV` | `production` |
| `WEB_ORIGIN` | `https://agrobridge.com,https://localhost` — the second entry is the Capacitor origin; without it the APK's requests are CORS-blocked |
| `API_PUBLIC_URL` | `https://api.agrobridge.com` — used for payment-gateway return URLs |
| `ALLOW_PLACEHOLDER_PROVIDERS` | `1` while weather/AI/SMS are not yet contracted. Startup logs each accepted placeholder. |
| `STORAGE_PROVIDER` | `s3` + `S3_*` once a bucket exists. Otherwise uploads live on the instance disk and are lost on redeploy (the startup warning says so). |
| `PAYMENT_PROVIDER` | Leave unset/`sandbox` to launch without taking money. See step 4a. |
| `ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION` | **Temporary pilot flag.** `1` lets a production deployment complete simulated payments so the checkout can be demonstrated end to end. It must be **removed before the Play submission** (see the pre-submission checklist at the end of this document). It is listed in the API's startup warning so a deployment using it says so out loud in its logs. |
| `REDIS_URL` | Recommended: without it, rate limits are per-instance |
| `METRICS_TOKEN` | Recommended: `/metrics` is otherwise reachable behind the proxy |

Migrations:

```bash
node apps/api/scripts/deploy-migrations.mjs      # applies the Postgres chain, idempotent
```

Smoke test:

```bash
curl -s https://api.agrobridge.com/health
curl -s https://api.agrobridge.com/ready         # {"ok":true,"ready":true,"db":true}
```

## 4. Payments: pick one, deliberately

- **Launch without online payments (default).** `PAYMENT_PROVIDER` unset → orders are created
  and remain **unpaid**, and the app says exactly that. Nothing pretends money moved.
- **Launch with real payments.** Set `PAYMENT_PROVIDER=sslcommerz` plus
  `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`, `SSLCOMMERZ_SANDBOX=false`. The
  `/payments/intent` endpoint then creates a real gateway session and returns a hosted
  checkout URL; the buyer returns through `/payments/gateway/return/…`, which verifies with
  the gateway before anything is marked paid (the signed webhook is the primary path).
  Test once with `SSLCOMMERZ_SANDBOX=true` before switching to live.
- **Demo/pilot only.** `ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION=1` lets production simulate
  successful payments. Label it in the listing and the reviewer notes; never ship a real
  launch in this mode (it looks like an app that reports payments it never collected).

## 5. Create the upload keystore (once, then guard it forever)

```bash
keytool -genkeypair -v \
  -keystore agrobridge-release.keystore \
  -alias agrobridge \
  -keyalg RSA -keysize 2048 -validity 10000
```

- **Back it up** somewhere durable (password manager + offline copy). Losing it means you
  cannot update the app under the same identity unless Play App Signing holds the app key.
- Enrol in **Play App Signing** during first upload and keep this file as the *upload* key.
- Add these four repository secrets (`Settings → Secrets and variables → Actions`):

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -w0 agrobridge-release.keystore` |
| `KEYSTORE_PASSWORD` | keystore password |
| `KEY_ALIAS` | `agrobridge` |
| `KEY_PASSWORD` | key password |

The keystore and `key.properties` are git-ignored and must never be committed. The release
workflow writes `key.properties`, builds, **and fails if the artifact is unsigned or
debug-signed** — a wrongly-signed upload can no longer reach the Console by accident.

## 6. Bump the version and build the AAB

```bash
# edit version.json: version + a strictly larger versionCode (Play rejects a reused code)
git commit -am "release: v1.5.0 (versionCode 14001)"
git push
gh workflow run android-release.yml        # or Actions → "Signed Android release" → Run
gh run watch
```

The workflow builds the PWA, syncs it into the Android project, asserts the synced bundle's
`version.json` matches the repo's, builds `bundleRelease` + `assembleRelease`, verifies the
signature, and uploads both artifacts. `version.json` is the single source of truth for the
web bundle and the Android `versionName`/`versionCode` — they cannot drift.

## 7. Google Play Console — first submission

Create the app (`com.agrobridge.app`, name "AgroBridge"), then complete, in this order:

1. **App content** — privacy policy URL `https://<domain>/privacy`; data deletion URL
   `https://<domain>/account-deletion`; ads: none; content rating questionnaire
   (`docs/play/listing-copy.md` §"Content rating questionnaire"); target audience 18+;
   **Data safety** exactly as in `docs/play/data-safety.md`; **App access** with the
   reviewer credentials from `docs/play/reviewer-access.md`.
2. **Store listing** — copy and assets from `docs/play/listing-copy.md` (`play/` directory).
3. **Production → Create release** — upload `app-release.aab` from the workflow artifact.
4. **Rollout** — 20% → watch Android vitals + crash-free rate → 100%.
   (A brand-new personal developer account must first run a closed test with 12+ testers for
   14 days; an organisation account has no such gate.)

## 7b. Deployment is verified, not assumed

Every push to `main` triggers **Deploy verification** (`.github/workflows/deploy-verify.yml`). It
checks, per project, that the running build **includes the newest changes to that project** and
that the commit it reports comes from `main`:

- web: the commit in the bundle's `version.json` must contain every commit that touched
  `apps/web`/`version.json`, and must be reachable from `main`;
- API: `/ready` must confirm the database, `/health` must report a commit that contains every
  commit touching `apps/api`/`version.json`/the API build script, and the public
  `/payments/gateway/return/success` route must answer 303.

The gate is deliberately **not** "production equals HEAD": Vercel deploys per project, so a
web-only commit legitimately leaves the API on an earlier commit (observed with `201172e`). A red
job means production is stale for that project, or is running something not on `main` — redeploy;
never re-run the check and move on. (Before this gate existed, "deployed" was an inference from a
CLI output.)

## 8. After launch

- Watch `https://api.agrobridge.com/ready` and the API logs (`requestId` + `AB-XXXXX`
  reference codes correlate a user's screenshot with the exact log line).
- Android vitals: crash-free sessions, ANR rate. The app has no crash SDK on purpose; the
  Play Console vitals and the API's error logs are the signal.
- Rotate the reviewer password after the review completes.
- Next release: bump `version.json`, repeat steps 6–7. Nothing else changes.

## Troubleshooting

| Symptom | Cause |
|---|---|
| APK shows "no internet" on every request | `VITE_API_BASE_URL` was not set when the bundle was built, or `WEB_ORIGIN` on the API is missing `https://localhost` |
| Login works in the browser but not in the APK | CORS: add the Capacitor origin to `WEB_ORIGIN` |
| Payment screen says "gateway not configured" in production | Expected when `PAYMENT_PROVIDER` is unset — see step 4 |
| Disease upload works, then the image 404s later | `STORAGE_PROVIDER=local` on a serverless host; configure S3 (step 3) |
| Workflow fails "artifact is debug-signed" | The four signing secrets are missing or wrong (step 5) |
| Play rejects the upload: version code already used | Bump `versionCode` in `version.json` |

---

## Pre-submission checklist (run this the day you upload)

- [ ] **Remove `ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION` from the production environment** and
      redeploy the API. Production must refuse to simulate a payment at submission time; the
      startup log no longer lists it (confirm by reading the deployment log).
- [ ] `version.json` matches the version you intend to publish; `versionCode` is strictly larger
      than every code previously uploaded.
- [ ] Signed AAB produced by `android-release.yml` with the four signing secrets present, and the
      workflow's signature verification passed (it fails otherwise).
- [ ] `docs/play/data-safety.md` answers transcribed into the Console unchanged; the reviewer
      account in `docs/play/reviewer-access.md` signs in successfully *on the submission build*.
- [ ] Privacy policy and data-deletion URLs load over the production domain (not the Vercel
      preview URL).
- [ ] Deploy verification job green on the commit you are shipping.
