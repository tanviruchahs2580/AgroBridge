# Launch checklist — credentials, secrets and the go-live runbook

This is the operator's path from "nothing set" to "submitted to Google Play": every credential or
environment value the deployment needs, where it goes, and the exact order to apply them in. It
assumes the repository state is the reviewed remediation branch and that the owner has a Google
Play developer account and a domain.

What the owner provides, at a glance:

1. Repository secrets: 4 keystore secrets (Android release build today); 5th name reserved for a
   future Play upload pipeline (see §1).
2. Vercel API environment: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
   `NODE_ENV`, `WEB_ORIGIN`, `STORAGE_PROVIDER=db`, `ALLOW_PLACEHOLDER_PROVIDERS` — plus
   `SMS_PROVIDER=http` + `SMS_API_URL` + `SMS_API_KEY` for real OTP, `REDIS_URL` (recommended),
   and the `SSLCOMMERZ_*` set only when taking live payments.
3. Vercel web environment: `VITE_API_BASE_URL` (+ custom domain).
4. Play Console inputs: listing copy, artwork, content rating, data safety, reviewer access,
   deletion URL, privacy URL.
5. Account-level: Play developer account, upload keystore, custom domain. The "blocked until
   owner" list in §6 names everything else.

Anything money-related launches **without** a live gateway by default: leaving `PAYMENT_PROVIDER`
unset keeps payments simulated/absent and must be declared as such (see §4, financial features).

---

## 1. Repository secrets (`Settings → Secrets and variables → Actions`)

The signed-release workflow reads exactly four secrets — its first step fails the run and names
any that are missing (`.github/workflows/android-release.yml:22-39`, consumed at `:59-80`):

| Secret | What it is | How to create it | Where it goes |
|---|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | The release **upload keystore**, base64-encoded, decoded by CI into the build directory | Create the keystore (below), keep the original safe, then encode it: Git Bash: `base64 -w0 agrobridge-release.keystore.jks`; PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("agrobridge-release.keystore.jks"))` | Repo → Settings → Secrets and variables → Actions → New repository secret |
| `KEYSTORE_PASSWORD` | The keystore password chosen when generating it | Chosen by you at `keytool` prompt; store in a password manager — losing it means the keystore is unusable | same |
| `KEY_ALIAS` | Keystore entry alias | The `-alias` you passed to `keytool` (the repo convention is `agrobridge`) | same |
| `KEY_PASSWORD` | Key password (often same as keystore password; asked separately by `keytool`) | Chosen by you; store with the keystore | same |

Keystore generation (concrete flags, no default passwords — you will be prompted to choose them;
`docs/android-release.md:95-98`, `docs/play/release-runbook.md:115-120`):

```bash
keytool -genkeypair -v -keystore agrobridge-release.keystore.jks \
  -alias agrobridge -keyalg RSA -keysize 2048 -validity 10000
```

Rules that matter more than the command:

- The keystore and `key.properties` are git-ignored and **never committed**; CI writes the
  properties file from the secrets at build time (`android-release.yml:59-80`).
- Keep one durable backup (password manager + offline copy). Google Play updates are bound to the
  signing key; enrol in Play App Signing on first upload and keep this file as the *upload* key
  (`docs/play/release-runbook.md:121-124`).
- CI verifies the artifacts before upload: an unsigned or debug-signed AAB/APK fails the run
  (`android-release.yml:115-144`). A wrongly-signed build cannot reach the Console by accident.

### The reserved fifth name: `PLAY_SERVICE_ACCOUNT_JSON`

There is **no `play-upload.yml` in `.github/workflows` as of 2026-10-19** — the workflows present
are `android-debug-apk.yml`, `android-release.yml`, `ci.yml`, `codeql.yml`, `deploy-staging.yml`,
`deploy-verify.yml`. The release workflow builds and hands you the AAB as an artifact; the upload
to Play is a manual step (§5, steps 7–8). If an automated upload pipeline is added, it needs the
Google Play service-account JSON under the name `PLAY_SERVICE_ACCOUNT_JSON`. How to create it
(official steps, fetched 2026-10-19 from
`https://developers.google.com/android-publisher/getting_started`):

1. In Google Cloud Console: create (or reuse) a project, then enable the **Google Play Developer
   API** for it. (Linking the developer account to a Cloud project is no longer a prerequisite for
   API access, per the same page.)
2. Create a **service account** in that project (IAM → Service Accounts → Create).
3. Back in **Play Console → Users and permissions** (the guided variant of this lives under
   **Setup → API access**): invite the service-account email and grant the release permissions the
   pipeline needs for your tracks ("Release to testing tracks" / "Release to production", as shown
   in the app-level permission list). Only that account can then upload builds.
4. In Google Cloud, open the service account → **Keys → Add key → Create new key → JSON**, and
   download the file. Store it as the `PLAY_SERVICE_ACCOUNT_JSON` repository secret; never commit
   it.

A newly created service account may not be accepted immediately; if an automated pipeline reports
permission errors right after creation, re-check the invitation status and retry later. The manual
upload path in §5 does not depend on this account at all.

## 2. Vercel environment — API project (`agro-bridge-api`)

Set under Vercel → project `agro-bridge-api` → Settings → Environment Variables (Production; the
repository's runbook is `docs/runbooks/live-deployment.md:47-58`, and the code schema with the
production fail-fast guards is `apps/api/src/config/env.ts`). "Required now" means the launch
described in this file; "later" means a deliberate follow-up activation.

| Variable | Required | Value / source | Why |
|---|---|---|---|
| `DATABASE_URL` (+`POSTGRES_*`) | now | injected by the Neon marketplace integration | PostgreSQL connection (`env.ts:21`) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | now | random 32-byte hex each | production boot aborts on default/dev values (`env.ts:22-23`, `:135-140`) |
| `NODE_ENV` | now | `production` | picks the production guardrails |
| `WEB_ORIGIN` | now | comma list; see §3 for the domain step | CORS allow-list and redirect origin (`env.ts:7`, `:194-232`) |
| `STORAGE_PROVIDER` | now | **`db`** | uploads survive redeploys without extra infrastructure; any `local` provider fails the deploy gate (`deploy-verify.yml:198-213`; ADR-0012 `docs/adr/0012-durable-uploads-in-database.md:27-31`) |
| `ALLOW_PLACEHOLDER_PROVIDERS` | now, while any placeholder remains | `1` | without it the API refuses to boot when a placeholder provider is active; with it, the startup log lists every accepted placeholder (`env.ts:141-152`, `:104-117`). The flag is an acknowledgement, not a configuration — remove it once every placeholder is replaced |
| `API_PUBLIC_URL` | now if payments will run | `https://<api-domain>` | payment-gateway return URLs (`env.ts:20`); optional while no gateway is configured |
| `SMS_PROVIDER` + `SMS_API_URL` + `SMS_API_KEY` | now for real OTP | `http` + your gateway's POST endpoint + its API key (optional `SMS_SENDER_ID`) | the adapter posts `{ to, text }` with a bearer token; production boot aborts on `http` without URL/key (`env.ts:63-72`, `:171-173`). Left as `sandbox`, OTP codes are only logged and real users cannot verify phones |
| `REDIS_URL` | recommended now | your Redis connection string | without it rate-limit windows are per-function-instance and fail open (`env.ts:37`; the limitation is documented in `docs/security.md` and surfaced on `/ready` as `limiterStore`) |
| `METRICS_TOKEN` | optional | random string | when set, `/metrics` requires the bearer token in production (`env.ts:36`) |
| `WEATHER_PROVIDER` + `OPENWEATHER_API_KEY` | later | `openweather` + key | real weather; boot aborts if the provider is `openweather` without a key (`env.ts:38-39`, `:154-156`) |
| `AI_PROVIDER` + `OPENAI_API_KEY` (+ `AI_COST_PER_1K_TOKENS_PAISA` > 0) | later | `openai-compatible` + key + real per-1K price in paisa | hosted advisory; boot aborts without the key, and the spend breaker must be armed or boot aborts too (`env.ts:46-51`, `:157-159`, `:128-132`) |
| `PAYMENT_PROVIDER` + `SSLCOMMERZ_STORE_ID` + `SSLCOMMERZ_STORE_PASSWORD` + `SSLCOMMERZ_SANDBOX=false` | later (live money) | SSLCommerz merchant credentials | live gateway; boot aborts when `sslcommerz` is selected without store id/password (`env.ts:52-55`, `:166-169`). Test with `SSLCOMMERZ_SANDBOX=true` once before switching (`docs/play/release-runbook.md:103-108`) |
| `S3_BUCKET`/`S3_REGION`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` (+`S3_ENDPOINT`) | later (only if leaving `db`) | object storage credentials | `STORAGE_PROVIDER=s3` boot-guards on these (`env.ts:74-78`, `:160-165`); switch only when volumes justify it (ADR-0012) |

Launch-time money rule: `ALLOW_SANDBOX_PAYMENTS_IN_PRODUCTION` must **not** be set on the
submission deployment. It lets production complete *simulated* payments and is demo-only; an app
that reports payments it never collected is a deceptive-behaviour finding, not a configuration
detail (`env.ts:56-62`, `:110-113`; `docs/play/release-runbook.md:210-212`).

## 3. Vercel environment — web project (`agrobridge-web`), domain and `WEB_ORIGIN`

| Variable | Value | Where |
|---|---|---|
| `VITE_API_BASE_URL` | `https://<api-domain>/api/v1` | Vercel web project env; keep `apps/web/.env.production` in sync in the same commit — CI/local Android builds bake the URL from that file (`docs/play/release-runbook.md:52-59`, `docs/runbooks/live-deployment.md:81-89`) |

Custom domain, official flow (fetched 2026-10-19 from
`https://vercel.com/docs/domains/working-with-domains/add-a-domain`):

1. Vercel dashboard → the web project → **Settings → Domains → Add Domain**; enter the domain
   (Vercel prompts to add `www` for an apex domain). The same page works for the API project with
   an `api.` subdomain.
2. Configure DNS at your registrar: **A record** for an apex domain, **CNAME** for a subdomain;
   the dashboard shows the exact record values. Vercel issues and renews the certificate for the
   domain and shows certificate status in Settings → Domains.
3. After both domains resolve, update `WEB_ORIGIN` on the API project. The allow-list must
   include: `https://<web-domain>` (first entry — it is also the redirect origin), the API origin
   if needed, and `https://localhost` (the Capacitor WebView origin; without it the Android app's
   requests are CORS-blocked). `http://localhost` entries are dropped from the allow-list in
   production by design (`apps/api/src/config/env.ts:194-232`; `docs/android-release.md:22-27`).
4. Redeploy the API after changing `WEB_ORIGIN`; verify with the smoke test in §5 step 4.

## 4. Play Console listing inputs

Paste-ready copy lives in `docs/play/listing-copy.md` — character counts are included there and
the listing was written to stay honest (no fabricated diagnosis, guaranteed yield or completed
payment claims).

- **App name / category / price:** `AgroBridge — কৃষকের সঙ্গী`; Business (alternate Productivity);
  Free; no ads, no in-app purchases (`docs/play/listing-copy.md:6-8`).
- **Short + full description:** both bn and en are paste-ready in `docs/play/listing-copy.md`;
  the English line "AI crop advice, weather alerts, market and farm services in one app." is the
  short description. Owner action: native-Bangla review is still pending (§6) — treat the bn copy
  as needing sign-off before it is published.
- **Screenshots:** 10 phone screenshots at 1080×1920 in `play/screenshots/`
  (`phone-01-login.jpg` … `phone-10-delete-account.jpg`); Play accepts 2–8, so pick the strongest
  set. Tablet screenshots are not provided (layout is responsive but untested on tablets —
  `docs/play/listing-copy.md:104-111`). Regeneration scripts:
  `node scripts/play/capture-screenshots.mjs` and `python scripts/play/generate-play-assets.py`.
- **Feature graphic / icon:** `play/feature-graphic-1024x500.png`, `play/icon-512.png`
  (requirements and regeneration in `docs/play/listing-copy.md:104-111`).
- **Content rating (IARC questionnaire):** expected outcome 3+ / Everyone. Answer no to violence,
  sexuality, profanity, gambling, and to user-to-user content sharing (listings are
  platform-moderated); no location sharing (`docs/play/listing-copy.md:96`). Complete the
  questionnaire in Play Console → App content; the ratings are issued against the Console account
  and must be re-taken if content or data collection changes.
- **Data safety form:** populate from `docs/play/data-safety.md`, which maps every answer to the
  code path that makes it true. Answers that must stay in lockstep with the code (owner: re-check
  each against the deployment being submitted):
  1. Collects data: **Yes**; name, phone, optional email, optional address — register/patch paths
     `apps/api/src/modules/auth/routes.ts:124-130`, `:325-350`.
  2. Phone is **shared** with the SMS provider solely to deliver the OTP (choose the provider at
     `SMS_PROVIDER=http` and name it in the policy — `apps/api/src/config/env.ts:63-72`).
  3. Location: **not collected** — the app never calls geolocation; weather uses the typed
     district (`apps/web/src/lib/geo.ts`), and no location permission is declared in the manifest
     (`docs/play/data-safety.md:23`).
  4. Device/advertising IDs: **not collected** — analytics posts event name + props only
     (`apps/web/src/lib/analytics.ts`; `docs/play/data-safety.md:24`).
  5. Photos: collected (optional) for disease review, ≤8 MB, image MIME allowlist; shared with the
     storage/review path (`docs/play/data-safety.md:20,51`). If the deployment stores them in the
     database, phrase the "shared with cloud storage provider" sentence accordingly.
  6. AI questions: sent to a third-party provider **only when** `AI_PROVIDER=openai-compatible`;
     with the default offline engine nothing leaves the server (`docs/play/data-safety.md:52`).
  7. Deletion: **Yes** — in-app Settings → Account and the web resource (§below).
  8. Encryption in transit: **Yes** — HTTPS only; the Android release build refuses cleartext
     (`docs/play/data-safety.md:37`).
  The form must stay accurate at all times, is global across all distributed versions, and is
  required before open/closed/production tracks (internal-testing-only apps are exempt) —
  official page fetched 2026-10-19: `https://support.google.com/googleplay/android-developer/answer/10787469`.
- **Financial features:** declare **"Payments" only if a live payment gateway is configured**
  (`PAYMENT_PROVIDER=sslcommerz` with merchant credentials). With the default sandbox/unset
  configuration the app collects no money, so declaring payments would be wrong
  (`docs/play/data-safety.md:59-65`).
- **Reviewer access (App access):** see `docs/play/reviewer-access.md`. Create the account first:

  ```bash
  node scripts/play/create-reviewer-account.mjs \
    --api https://<api-domain>/api/v1 --phone 01700000099 --password '<strong unique password>'
  ```

  The script is idempotent (re-running resets the password and repairs account state), seeds a
  farm and a little wallet balance, and never uses the seeded demo credentials
  (`scripts/play/create-reviewer-account.mjs` header; `docs/play/reviewer-access.md:8-20`). Paste
  the paste-ready block into App content → App access, and sign in once through the submitted
  build to confirm the credentials match reality. `--verify-phone` only if you want reviewers to
  test withdrawals.
- **Account deletion URL:** `https://<web-domain>/account-deletion`. Google requires an in-app
  deletion path **and** a functional web resource that lets users request deletion without
  returning to the app — both exist (official page fetched 2026-10-19:
  `https://support.google.com/googleplay/android-developer/answer/13327111`;
  in-app: `apps/api/src/modules/auth/routes.ts:520`).
- **Privacy policy URL:** `https://<web-domain>/privacy` — required for every app, including
  apps that collect nothing (official page fetched 2026-10-19, same Data safety URL above). The
  runtime page is generated from `apps/web/src/features/legal/content.ts`; the root
  `PRIVACY_POLICY.md`/`TERMS_OF_SERVICE.md` copies carry the owner action for entity details.
- **Support email / website:** the monitored address in `LEGAL_ENTITY` (`content.ts:16-27`) and
  `https://<web-domain>`.

## 5. Order of operations (owner: secrets first, then build, then tracks)

1. **Repository secrets.** Create the keystore, add the four Android secrets (§1). Add
   `PLAY_SERVICE_ACCOUNT_JSON` only if/when an automated upload pipeline exists.
2. **Environment.** Set the API project env from §2 ("required now" rows) and the web project's
   `VITE_API_BASE_URL` (§3); add the custom domains and update `WEB_ORIGIN`; redeploy both
   projects.
3. **Migrations.** Apply the PostgreSQL chain (idempotent, baseline-aware — safe to re-run):
   ```bash
   cd apps/api
   export DATABASE_URL="$DATABASE_URL_UNPOOLED"   # direct connection for DDL
   node scripts/deploy-migrations.mjs
   ```
   From the repo root the same script is `node apps/api/scripts/deploy-migrations.mjs`
   (`apps/api/scripts/deploy-migrations.mjs:20`; `docs/runbooks/live-deployment.md:59-71`). The
   deploy gate fails the release if production's applied chain is older than the repository's
   (`docs/adr/0007-schema-state-in-release-contract.md`).
4. **Smoke.** `curl -s https://<api-domain>/health`, `curl -s https://<api-domain>/ready` — the
   ready payload must report the database and `storage: { durable: true }`; the deploy-verify
   workflow asserts the durable-storage property on every merge (`deploy-verify.yml:198-213`).
5. **Reviewer account.** Run the create-reviewer-account command in §4 against production and
   sign in through the app once.
6. **Build the AAB.** Bump `version.json` (`versionCode` must strictly increase for every upload),
   commit, then dispatch the signed-release workflow:
   `gh workflow run android-release.yml` (or Actions → Android — Release). Download the
   `agrobridge-release-aab` artifact when the run is green; the run already verified the bundle
   version and the signature.
7. **Play Console — app record and App content.** Create the app, then complete the App content
   section: privacy policy URL, account deletion URL, ads = none, content rating (§4), target
   audience 18+, data safety (§4), App access with the reviewer block.
8. **Internal testing track.** Upload the AAB to Internal testing, install from the internal link
   on a real device, and walk the reviewer instructions end to end (login, home, market, wallet,
   delete-account screen without deleting the shared account).
9. **Closed testing.** Promote the build to Closed testing. A brand-new **personal** developer
   account needs a closed test with at least **12 testers opted in continuously for 14 days**
   before applying for production access; the requirement is stated for personal accounts created
   after 2023-11-13 (official page fetched 2026-10-19:
   `https://support.google.com/googleplay/android-developer/answer/14151465`). Confirm your
   account type and the Console's current gate before planning the testing window.
10. **Production.** Promote to Production with a staged rollout (e.g. start at a low percentage),
    watch the Play Console vitals, then raise the percentage to 100% once stable. Rollout
    mechanics and halt/resume are on the Production → Releases page (official page fetched
    2026-10-19: `https://support.google.com/googleplay/android-developer/answer/6346149`).

### Rollback notes

- **Web/API (Vercel):** Production → Instant Rollback — dashboard: project overview → production
  deployment tile → Instant Rollback → pick the previous deployment → confirm; CLI:
  `vercel promote <deployment-url>` re-promotes a chosen deployment (official doc fetched
  2026-10-19: `https://vercel.com/docs/instant-rollback`). The rollback points your domains back
  to the old build instantaneously; note that environment-variable changes are *not* rolled back,
  so revert env changes separately and redeploy. After a rollback, new pushes to the production
  branch do not auto-replace it until you promote another deployment.
- **Android (Play):** Production (or the testing page) → Releases → the release → **Manage
  rollout → Halt rollout**. Halting stops new users from receiving the version; users who already
  update stay on it. Fix forward with a new `versionCode` and a new staged rollout.

## 6. Blocked until the owner acts

These cannot be closed from the repository; each is a decision or purchase only the owner can make.

| Item | What it blocks | Where it is tracked |
|---|---|---|
| Expert agronomist review of the knowledge base | sourcing claims and advisory sign-off; one of the largest remaining deductions | `docs/agronomy-review-sheet.md`; parameter rows API-10 and PRD-04 in `docs/qa/score-deductions.md` |
| Native-Bangla copy review | publishing the Bengali listing copy and in-app strings as final | `docs/qa/score-deductions.md` (SLP-14, WEB-04); `docs/glossary-bn-en.md` |
| Legal review of privacy policy and terms | Console submission of the policy URLs; entity details in `LEGAL_ENTITY` | root `PRIVACY_POLICY.md`, `TERMS_OF_SERVICE.md`; `docs/legal-compliance-checklist.md` |
| Live-payment credentials (SSLCommerz) | real payments + the financial-features declaration | §2 "later"; `docs/play/data-safety.md:59-65` |
| Custom domain purchase | stable privacy/deletion/support URLs (a Vercel subdomain works but is not the intended public URL) | §3 |
| Google Play developer account + upload keystore | creating the app record and signing the first upload | §1, §5 steps 6–7 |
| SMS gateway credentials | real OTP delivery to users | §2; `env.ts:63-72` |

## Cross-references

- End-to-end release procedure (older wording in a few places, e.g. the storage paragraph):
  `docs/play/release-runbook.md`.
- Readiness gate with per-requirement official sources: `docs/play/store-readiness-checklist.md`.
- Live topology and deploy commands: `docs/runbooks/live-deployment.md`.
- Secret rotation: `docs/runbooks/secret-rotation.md`.
- What is live vs pilot in production right now: `docs/STATUS.md`.
