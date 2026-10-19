# Play Store readiness checklist (requirements verified 2026-10-19)

Current Google Play submission requirements, each with the official page it was read from on
**2026-10-19**, the repository state that answers it, and an explicit marker when the remaining
step belongs to the owner. This checklist is the gate; the paste-ready copy lives in
`docs/play/listing-copy.md`, the data-safety evidence trail in `docs/play/data-safety.md`, and the
end-to-end procedure in `docs/play/release-runbook.md`.

Owner-only items in this file are marked **[OWNER]**: keystore and signing, push (FCM), the real
domain, privacy-policy review, and the Console forms themselves.

## 1. Target API level

**Requirement** (source: `https://developer.android.com/google/play/requirements/target-sdk`,
accessed 2026-10-19): "Starting August 31, 2026 … New apps and app updates must target Android 16
(API level 36) or higher to be submitted to Google Play … Existing apps must target Android 15
(API level 35) or higher to remain available to new users on devices running Android OS higher than
your app's target API level." An extension to November 1, 2026 can be requested in Play Console.

**Repository state:** `apps/web/android/variables.gradle` declares `compileSdkVersion = 36` and
`targetSdkVersion = 36`, `minSdkVersion = 24`; CI's Android job builds a debug APK, and the release
build type signs only with a real upload key (`apps/web/android/app/build.gradle` — no fallback to
debug signing).

- [ ] Confirm the AAB built for submission reports `targetSdkVersion 36` (build with
      `./gradlew bundleRelease` and inspect the manifest, or check Play Console's pre-launch report).
- [ ] Review the Android 16 behavior changes against the Capacitor shell before submitting
      (referenced by the same official page).
- [ ] If the release slips past a future deadline, request the Console extension deliberately —
      do not assume the current target satisfies later cycles.

## 2. Data safety form

**Requirement** (source: `https://support.google.com/googleplay/android-developer/answer/10787469`,
accessed 2026-10-19): all publishers with an app on Google Play (production, open/closed testing)
must complete the form; "Your Data safety form responses must remain accurate and complete at all
times"; the form covers the sum of data collection and sharing across all distributed versions;
the form must stay in sync whenever data practices change. Responsibility is the developer's:
"You alone are responsible for making complete and accurate declarations", and non-compliant apps
face "blocked updates or removal from Google Play".

**Repository state:** `docs/play/data-safety.md` maps every collected data type to the code path
that handles it (name/phone/email/address, purchase history, wallet ledger, photos, in-app
messages, first-party analytics) and states location and device IDs are not collected. Financial
features must be declared **only** if a live payment gateway is configured.

- [ ] Re-verify the data-safety answers against the deployment being submitted (provider modes
      change what is "shared": SMS provider, AI provider, photo storage).
- [ ] **[OWNER]** Submit/refresh the form in Play Console and keep the privacy policy link current.
- [ ] Reconcile the answer for Photos: `docs/play/data-safety.md` says photos are "stored by our
      cloud storage provider", while production currently runs `STORAGE_PROVIDER=db`
      (`docs/runbooks/live-deployment.md`), i.e. stored in our own database. Amend the sentence or
      the configuration so the declaration and the deployment agree.
- [ ] If the pilot stays on the sandbox payment provider, keep the financial-features declaration
      consistent with "no money collected" (see `docs/play/data-safety.md`).

## 3. Account deletion

**Requirement** (source: `https://support.google.com/googleplay/android-developer/answer/13327111`,
accessed 2026-10-19): apps that enable account creation must "provide users with an in-app path to
delete their app accounts and associated data" **and** "provide a web link resource where users can
request app account deletion and associated data deletion"; the link must be functional and in
scope, reference the app or developer name, and let users submit a request "without sending the
user back to the app". "All developers must complete new Data deletion questions in the Data safety
form."

**Repository state:** in-app deletion exists at Settings → Account (typed confirmation, blocked
while an order is in progress or a withdrawal is pending — `apps/api/src/modules/auth/routes.ts`
deletion section); public pages are served by the SPA at `/account-deletion`, `/privacy` and
`/terms` (`apps/web/src/App.tsx:52-54,326-328`; `apps/web/src/features/legal/Legal.tsx`). The
deletion flow anonymizes identity and retains financial rows as the policy states.

- [ ] **[OWNER]** Point the Data safety deletion link at the real domain (the Vercel subdomain
      works, but a stable product domain is the intended public URL — decision OD-09).
- [ ] **[OWNER]** Privacy-policy review by counsel before submission, and confirm the deletion page
      names the developer entity.
- [ ] Verify from a fresh browser that `/account-deletion` loads without login and submits a
      request without installing the app.

## 4. Content rating

**Requirement** (source: `https://support.google.com/googleplay/android-developer/answer/9859655`,
accessed 2026-10-19): the questionnaire is mandatory for "New apps submitted to Google Play
Console", "Existing apps that are active on Google Play but lack a rating", and "All app updates
where there has been a change to your content or features that would affect the responses";
ratings come from independent authorities via IARC; "Misrepresentation of your app's content may
result in its removal or suspension"; a refused classification blocks distribution in that
territory.

**Repository state:** no evidence of a completed questionnaire in the repository — the ratings are
issued against the Console account, not committed here.

- [ ] **[OWNER]** Complete the App content questionnaire in Play Console and record the resulting
      rating(s) in this file.
- [ ] Re-take the questionnaire if the app starts collecting new data or adds user-generated
      content sharing.

## 5. App access (reviewer sign-in details)

**Requirement** (source: `https://support.google.com/googleplay/android-developer/answer/9859455`,
accessed 2026-10-19): if the app is restricted by login credentials, membership or other
authentication, sign-in details must be provided; they are entered under App content → "Sign-in
details" (up to five sets of instructions), and special mechanisms such as one-time passwords
belong in "Any other instructions".

**Repository state:** `docs/play/reviewer-access.md` holds paste-ready instructions and
`scripts/play/create-reviewer-account.mjs` creates/seeds the reviewer account idempotently. The
registration flow itself requires a Bangladeshi phone number, which reviewers may not have, so the
pre-created account is the access path.

- [ ] **[OWNER]** Run the script against the production API with a unique strong password and verify
      sign-in once through the built app.
- [ ] **[OWNER]** Paste the instructions into App content → Sign-in details; keep credentials out of
      the store listing and screenshots.
- [ ] If the reviewer build runs sandbox payments, say so in the instructions (the current file
      already requires this).

## 6. Owner-gated infrastructure items

| Item | Status in repository | Owner action |
|---|---|---|
| Upload keystore | Signing wiring present, no keystore committed (correctly — `key.properties` is git-ignored; release build produces an unsigned artifact without it) | **[OWNER]** Create the upload keystore, store it in a password manager/secure backup, upload the app-signing key or enroll in Play App Signing |
| Push notifications (FCM) | No FCM/Firebase or `@capacitor/push-notifications` dependency exists in `apps/web/package.json`; notifications are in-app DB rows | **[OWNER]** Decide whether the store build needs push; if yes, create the Firebase project and add the SDK |
| Real domain | Runbook works from a Vercel subdomain; `WEB_ORIGIN`/`VITE_API_BASE_URL`/`API_PUBLIC_URL` are configured at deploy time | **[OWNER]** Register/point the domain, update the three variables and `apps/web/.env.production` together |
| Privacy policy review | Long-form bn/en copy in `apps/web/src/features/legal/content.ts`; `PRIVACY_POLICY.md`/`TERMS_OF_SERVICE.md` also exist at the root | **[OWNER]** Counsel review and reconcile the two copies before submission (decision OD-09) |
| Release runbook accuracy | `docs/play/release-runbook.md` still quotes older test counts and suggests `STORAGE_PROVIDER=s3` "otherwise uploads live on the instance disk" — the shipping default is now `db` and instance-disk uploads are rejected for production (`STORAGE_PROVIDER=db`, ADR-0012) | **[OWNER-ASSISTED]** Update the runbook text in the same change that prepares submission |
| Versioning | `version.json` is the single source for web and Android (`apps/web/android/app/build.gradle` reads it) | **[OWNER]** Confirm the versionCode/versionName for the first store build |

## 7. Order of operations

1. Owner: domain + keystore + FCM decision (§6), privacy review (§3).
2. Repo: re-run the release preflight from `docs/play/release-runbook.md` §0 against the submission
   commit and fix the stale counts there.
3. Owner: create the reviewer account and paste sign-in details (§5).
4. Owner: complete content rating (§4) and data safety (§2), with the deletion link (§3).
5. Build the AAB, verify target API 36 (§1), upload to the closed testing track.
6. After review is clean, promote; record the submitted version and rating in this file.
